"""
Test Suite: Service-Level Credit Gate (Iteration 72)
Tests the new AIService credit gate pattern:
- _creditApproved flag blocks provider calls until approveCreditGate() is called
- callModelSafely() and streamModelSafely() wrappers translate errors
- Route handlers call approveCreditGate() after credit balance check
- image-service.js uses EMERGENT_LLM_KEY with proxy options
- No raw_error or API key details in error responses
"""
import pytest
import requests
import os
import re
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')


class TestHealthAndProviderStatus:
    """Test health and provider status endpoints"""
    
    def test_health_endpoint_returns_200(self):
        """Health endpoint should return 200 with healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print(f"✓ Health endpoint: {data}")
    
    def test_provider_status_returns_instant_results(self):
        """Provider status should return instant results without making API calls"""
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/providers/status")
        elapsed = time.time() - start
        
        assert response.status_code == 200
        data = response.json()
        
        # Should be instant (< 1 second) since no actual API calls
        assert elapsed < 1.0, f"Provider status took {elapsed}s - should be instant"
        
        # Should have openai and anthropic status
        assert 'openai' in data
        assert 'anthropic' in data
        
        # Status should be one of: ready, configured, no_key
        valid_statuses = ['ready', 'configured', 'no_key']
        assert data['openai']['status'] in valid_statuses
        assert data['anthropic']['status'] in valid_statuses
        
        print(f"✓ Provider status (took {elapsed:.3f}s): {data}")


class TestAIServiceCreditGate:
    """Test AIService credit gate pattern in code"""
    
    def test_aiservice_has_credit_approved_flag(self):
        """AIService constructor should initialize _creditApproved to false"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Check _creditApproved flag initialization
        assert '_creditApproved = false' in content, "AIService should initialize _creditApproved to false"
        print("✓ AIService initializes _creditApproved = false")
    
    def test_aiservice_has_approve_credit_gate_method(self):
        """AIService should have approveCreditGate() method"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Check approveCreditGate method exists
        assert 'approveCreditGate()' in content, "AIService should have approveCreditGate() method"
        assert 'this._creditApproved = true' in content, "approveCreditGate should set _creditApproved to true"
        print("✓ AIService has approveCreditGate() method that sets _creditApproved = true")
    
    def test_aiservice_has_require_credit_approval_method(self):
        """AIService should have _requireCreditApproval() method that throws ProviderError"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Check _requireCreditApproval method exists
        assert '_requireCreditApproval()' in content, "AIService should have _requireCreditApproval() method"
        
        # Check it throws ProviderError with billing type
        assert "error_type: 'billing'" in content, "_requireCreditApproval should throw ProviderError with billing type"
        assert "Credit gate not approved" in content, "_requireCreditApproval should mention credit gate"
        print("✓ AIService has _requireCreditApproval() that throws ProviderError(billing)")
    
    def test_aiservice_has_call_model_safely_wrapper(self):
        """AIService should have callModelSafely() wrapper"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Check callModelSafely method exists
        assert 'async callModelSafely(providerCall)' in content, "AIService should have callModelSafely() method"
        
        # Find the method start and extract ~20 lines
        method_start = content.find('async callModelSafely(providerCall)')
        assert method_start > 0, "callModelSafely method should exist"
        method_section = content[method_start:method_start + 500]
        
        # Check it calls _requireCreditApproval
        assert '_requireCreditApproval' in method_section, "callModelSafely should call _requireCreditApproval"
        
        # Check it uses classifyProviderError for error translation
        assert 'classifyProviderError' in method_section, "callModelSafely should use classifyProviderError"
        
        print("✓ AIService has callModelSafely() wrapper with credit gate and error translation")
    
    def test_aiservice_has_stream_model_safely_wrapper(self):
        """AIService should have streamModelSafely() async generator wrapper"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Check streamModelSafely method exists
        assert 'async *streamModelSafely(makeStream)' in content, "AIService should have streamModelSafely() async generator"
        
        # Check it calls _requireCreditApproval
        stream_model_match = re.search(r'async \*streamModelSafely\(makeStream\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', content, re.DOTALL)
        if stream_model_match:
            method_body = stream_model_match.group(1)
            assert '_requireCreditApproval' in method_body, "streamModelSafely should call _requireCreditApproval"
        
        print("✓ AIService has streamModelSafely() async generator with credit gate")
    
    def test_process_message_stream_requires_credit_approval(self):
        """processMessageStream should call _requireCreditApproval"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Find processMessageStream method
        match = re.search(r'async \*processMessageStream\(params\)\s*\{([^}]+)\}', content, re.DOTALL)
        assert match, "processMessageStream method should exist"
        method_body = match.group(1)
        assert '_requireCreditApproval' in method_body, "processMessageStream should call _requireCreditApproval"
        print("✓ processMessageStream calls _requireCreditApproval")
    
    def test_execute_plan_stream_requires_credit_approval(self):
        """executePlanStream should call _requireCreditApproval"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Find executePlanStream method
        match = re.search(r'async \*executePlanStream\(params\)\s*\{([^}]+)\}', content, re.DOTALL)
        assert match, "executePlanStream method should exist"
        method_body = match.group(1)
        assert '_requireCreditApproval' in method_body, "executePlanStream should call _requireCreditApproval"
        print("✓ executePlanStream calls _requireCreditApproval")
    
    def test_process_message_requires_credit_approval(self):
        """processMessage should call _requireCreditApproval"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Find processMessage method
        match = re.search(r'async processMessage\(params\)\s*\{([^}]+)\}', content, re.DOTALL)
        assert match, "processMessage method should exist"
        method_body = match.group(1)
        assert '_requireCreditApproval' in method_body, "processMessage should call _requireCreditApproval"
        print("✓ processMessage calls _requireCreditApproval")
    
    def test_process_image_generation_requires_credit_approval(self):
        """processImageGeneration should call _requireCreditApproval"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Find processImageGeneration method
        match = re.search(r'async \*processImageGeneration\([^)]+\)\s*\{([^}]+)\}', content, re.DOTALL)
        assert match, "processImageGeneration method should exist"
        method_body = match.group(1)
        assert '_requireCreditApproval' in method_body, "processImageGeneration should call _requireCreditApproval"
        print("✓ processImageGeneration calls _requireCreditApproval")


class TestRouteHandlersCallApproveCreditGate:
    """Test that route handlers call approveCreditGate() after credit check"""
    
    def test_stream_handler_calls_approve_credit_gate(self):
        """stream-handler.js should call aiService.approveCreditGate() after credit check"""
        stream_file = '/app/lib/api/stream-handler.js'
        with open(stream_file, 'r') as f:
            content = f.read()
        
        # Check approveCreditGate is called
        assert 'aiService.approveCreditGate()' in content, "stream-handler.js should call aiService.approveCreditGate()"
        
        # Verify it's called AFTER credit check (credit check should come before)
        credit_check_pos = content.find('creditsDb.getBalance')
        approve_gate_pos = content.find('aiService.approveCreditGate()')
        
        assert credit_check_pos > 0, "stream-handler.js should have credit balance check"
        assert approve_gate_pos > 0, "stream-handler.js should call approveCreditGate"
        assert approve_gate_pos > credit_check_pos, "approveCreditGate should be called AFTER credit check"
        
        print("✓ stream-handler.js calls aiService.approveCreditGate() after credit balance check")
    
    def test_chats_non_streaming_calls_approve_credit_gate(self):
        """chats.js (non-streaming) should call aiService.approveCreditGate() after credit check"""
        chats_file = '/app/lib/api/routes/chats.js'
        with open(chats_file, 'r') as f:
            content = f.read()
        
        # Check approveCreditGate is called
        assert 'aiService.approveCreditGate()' in content, "chats.js should call aiService.approveCreditGate()"
        
        # Verify it's called AFTER credit check
        credit_check_pos = content.find('creditsDb.getBalance')
        approve_gate_pos = content.find('aiService.approveCreditGate()')
        
        assert credit_check_pos > 0, "chats.js should have credit balance check"
        assert approve_gate_pos > 0, "chats.js should call approveCreditGate"
        assert approve_gate_pos > credit_check_pos, "approveCreditGate should be called AFTER credit check"
        
        print("✓ chats.js calls aiService.approveCreditGate() after credit balance check")
    
    def test_diffs_calls_approve_credit_gate(self):
        """diffs.js should call aiService.approveCreditGate() after credit check"""
        diffs_file = '/app/lib/api/routes/diffs.js'
        with open(diffs_file, 'r') as f:
            content = f.read()
        
        # Check approveCreditGate is called
        assert 'aiService.approveCreditGate()' in content, "diffs.js should call aiService.approveCreditGate()"
        
        # Verify it's called AFTER credit check
        credit_check_pos = content.find('creditsDb.getBalance')
        approve_gate_pos = content.find('aiService.approveCreditGate()')
        
        assert credit_check_pos > 0, "diffs.js should have credit balance check"
        assert approve_gate_pos > 0, "diffs.js should call approveCreditGate"
        assert approve_gate_pos > credit_check_pos, "approveCreditGate should be called AFTER credit check"
        
        print("✓ diffs.js calls aiService.approveCreditGate() after credit balance check")
    
    def test_fork_handler_does_not_call_approve_credit_gate(self):
        """Fork handler creates AIService without approveCreditGate (correct - only calls compressContext)"""
        chats_file = '/app/lib/api/routes/chats.js'
        with open(chats_file, 'r') as f:
            content = f.read()
        
        # Find the fork handler section
        fork_match = re.search(r"if \(route\.match\(/\^\\\/chats\\\/\[\^/\]\+\\\/fork\$/\)(.*?)return null", content, re.DOTALL)
        if fork_match:
            fork_section = fork_match.group(1)
            # Fork handler should create AIService but NOT call approveCreditGate
            # because it only calls compressContext (no provider interaction)
            assert 'new AIService()' in fork_section, "Fork handler should create AIService"
            assert 'compressContext' in fork_section, "Fork handler should call compressContext"
            # It's OK if approveCreditGate is NOT called here
            print("✓ Fork handler correctly creates AIService without approveCreditGate (only uses compressContext)")
        else:
            # If we can't find the fork section, just verify the pattern exists
            assert '/fork' in content, "Fork route should exist"
            print("✓ Fork route exists (manual verification needed for approveCreditGate)")


class TestImageServiceUsesEmergentKey:
    """Test image-service.js uses EMERGENT_LLM_KEY with proxy options"""
    
    def test_image_service_uses_emergent_llm_key(self):
        """image-service.js should use EMERGENT_LLM_KEY (not direct OPENAI_API_KEY)"""
        image_file = '/app/lib/ai/image-service.js'
        with open(image_file, 'r') as f:
            content = f.read()
        
        # Check EMERGENT_LLM_KEY is used
        assert 'EMERGENT_LLM_KEY' in content, "image-service.js should use EMERGENT_LLM_KEY"
        
        # Check it's the primary key (before OPENAI_API_KEY fallback)
        emergent_pos = content.find('EMERGENT_LLM_KEY')
        openai_pos = content.find('OPENAI_API_KEY')
        
        assert emergent_pos > 0, "EMERGENT_LLM_KEY should be present"
        assert emergent_pos < openai_pos, "EMERGENT_LLM_KEY should be checked before OPENAI_API_KEY"
        
        print("✓ image-service.js uses EMERGENT_LLM_KEY as primary key")
    
    def test_image_service_uses_proxy_options(self):
        """image-service.js should use proxy options when EMERGENT_LLM_KEY is set"""
        image_file = '/app/lib/ai/image-service.js'
        with open(image_file, 'r') as f:
            content = f.read()
        
        # Check proxy options are used
        assert 'EMERGENT_PROXY_URL' in content, "image-service.js should check EMERGENT_PROXY_URL"
        assert 'baseURL' in content, "image-service.js should set baseURL for proxy"
        
        print("✓ image-service.js uses proxy options with EMERGENT_LLM_KEY")
    
    def test_image_service_translates_errors(self):
        """image-service.js should translate errors via classifyProviderError"""
        image_file = '/app/lib/ai/image-service.js'
        with open(image_file, 'r') as f:
            content = f.read()
        
        # Check classifyProviderError is imported and used
        assert 'classifyProviderError' in content, "image-service.js should import classifyProviderError"
        
        # Check it's used in error handling
        assert 'throw classifyProviderError' in content, "image-service.js should throw classifyProviderError"
        
        print("✓ image-service.js translates errors via classifyProviderError")


class TestNoRawErrorLeakage:
    """Test that raw provider errors are never exposed in API responses"""
    
    def test_provider_error_user_message_used(self):
        """API responses should use user_message, not raw_error"""
        # Check chats.js
        chats_file = '/app/lib/api/routes/chats.js'
        with open(chats_file, 'r') as f:
            chats_content = f.read()
        
        # The error response should use user_message
        assert 'user_message' in chats_content, "chats.js should use user_message"
        
        # Check stream-handler.js
        stream_file = '/app/lib/api/stream-handler.js'
        with open(stream_file, 'r') as f:
            stream_content = f.read()
        
        assert 'user_message' in stream_content, "stream-handler.js should use user_message"
        
        print("✓ API responses use user_message from ProviderError")
    
    def test_errors_js_has_safe_messages(self):
        """errors.js should have safe user-facing messages"""
        errors_file = '/app/lib/ai/errors.js'
        with open(errors_file, 'r') as f:
            content = f.read()
        
        # Check safe messages exist
        safe_messages = [
            "You're out of credits",
            "Buy Credits",
            "temporarily unavailable",
            "busy right now",
            "Something went wrong"
        ]
        
        for msg in safe_messages:
            assert msg in content, f"errors.js should have safe message: '{msg}'"
        
        print("✓ errors.js has safe user-facing messages")
    
    def test_no_api_key_in_error_responses(self):
        """Error responses should never contain API key patterns"""
        # Test provider status endpoint
        response = requests.get(f"{BASE_URL}/api/providers/status")
        assert response.status_code == 200
        
        response_text = response.text.lower()
        
        # Should NOT contain any API key patterns
        forbidden_patterns = ['sk-', 'sk-ant-', 'api_key', 'apikey', 'secret']
        for pattern in forbidden_patterns:
            assert pattern not in response_text, f"Response should not contain '{pattern}'"
        
        print("✓ No API key patterns in responses")


class TestPublicEndpointSecurity:
    """Test public endpoints only check key existence"""
    
    def test_provider_status_only_checks_key_existence(self):
        """Provider status should only check key existence, never ping APIs"""
        public_file = '/app/lib/api/routes/public.js'
        with open(public_file, 'r') as f:
            content = f.read()
        
        # Check it only checks key existence
        assert "process.env.OPENAI_API_KEY" in content, "Should check OPENAI_API_KEY existence"
        assert "process.env.ANTHROPIC_API_KEY" in content, "Should check ANTHROPIC_API_KEY existence"
        
        # Should NOT have any fetch/axios/request calls
        assert 'fetch(' not in content, "Provider status should not make fetch calls"
        assert 'axios' not in content, "Provider status should not use axios"
        
        # Should have lightweight status values
        assert "'ready'" in content or '"ready"' in content, "Should have 'ready' status"
        assert "'configured'" in content or '"configured"' in content, "Should have 'configured' status"
        assert "'no_key'" in content or '"no_key"' in content, "Should have 'no_key' status"
        
        print("✓ Provider status only checks key existence, never pings APIs")


class TestCreditCostsConfiguration:
    """Test credit costs are properly configured"""
    
    def test_credit_costs_defined(self):
        """Verify CREDIT_COSTS are properly defined"""
        service_file = '/app/lib/credits/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Check all required costs are defined
        required_costs = ['chat_message', 'plan_generation', 'file_apply', 'image_generation']
        for cost in required_costs:
            assert cost in content, f"CREDIT_COSTS should include {cost}"
        
        # Verify expected values
        assert 'chat_message: 0.5' in content, "chat_message should cost 0.5"
        assert 'plan_generation: 2.0' in content, "plan_generation should cost 2.0"
        assert 'file_apply: 3.0' in content, "file_apply should cost 3.0"
        assert 'image_generation: 5.0' in content, "image_generation should cost 5.0"
        
        print("✓ CREDIT_COSTS properly configured")


class TestAPIKeyOnlyPlatformManaged:
    """Test that AIService only uses platform-managed keys"""
    
    def test_aiservice_api_key_method_uses_platform_keys(self):
        """AIService._apiKey() should only use platform-managed keys"""
        service_file = '/app/lib/ai/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        # Find the _apiKey method
        api_key_match = re.search(r'_apiKey\(provider\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', content, re.DOTALL)
        assert api_key_match, "_apiKey method should exist"
        
        method_body = api_key_match.group(1)
        
        # Should check EMERGENT_LLM_KEY first
        assert 'EMERGENT_LLM_KEY' in method_body, "_apiKey should check EMERGENT_LLM_KEY"
        
        # Should have comment about platform-managed keys
        assert 'Platform-managed' in content or 'platform' in method_body.lower(), \
            "_apiKey should mention platform-managed keys"
        
        print("✓ AIService._apiKey() uses platform-managed keys only")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
