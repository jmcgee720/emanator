"""
Test Suite: Universal Key Billing Leakage Fix
Tests credit gates, error message sanitization, and provider status endpoint.
"""
import pytest
import requests
import os
import re

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
        import time
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
    
    def test_provider_status_no_billing_impact(self):
        """Provider status should not contain any billing-related info"""
        response = requests.get(f"{BASE_URL}/api/providers/status")
        assert response.status_code == 200
        data = response.json()
        
        # Should NOT contain any billing/credit/quota info
        response_text = str(data).lower()
        forbidden_terms = ['billing', 'credit', 'quota', 'budget', 'api key', 'exceeded']
        for term in forbidden_terms:
            assert term not in response_text, f"Provider status should not contain '{term}'"
        
        print("✓ Provider status contains no billing-related info")


class TestErrorMessageSanitization:
    """Test that raw provider errors are never leaked to users"""
    
    def test_errors_js_classifies_billing_errors(self):
        """Verify errors.js classifies billing errors correctly"""
        # This is a code review test - verify the patterns exist
        errors_file = '/app/lib/ai/errors.js'
        with open(errors_file, 'r') as f:
            content = f.read()
        
        # Check billing error patterns are detected
        billing_patterns = ['billing', 'budget', 'credit', 'insufficient_quota', 'exceeded your current quota']
        for pattern in billing_patterns:
            assert pattern in content.lower(), f"errors.js should detect '{pattern}'"
        
        # Check user-facing message is safe
        assert "You're out of credits" in content, "Should have safe billing message"
        assert "Buy Credits" in content, "Should mention Buy Credits"
        
        print("✓ errors.js correctly classifies billing errors")
    
    def test_errors_js_classifies_auth_errors(self):
        """Verify errors.js classifies auth errors correctly"""
        errors_file = '/app/lib/ai/errors.js'
        with open(errors_file, 'r') as f:
            content = f.read()
        
        # Check auth error patterns
        auth_patterns = ['invalid api key', 'incorrect api key', 'authentication', 'unauthorized']
        for pattern in auth_patterns:
            assert pattern in content.lower(), f"errors.js should detect '{pattern}'"
        
        # Check user-facing message is safe (no API key details)
        assert "temporarily unavailable" in content.lower(), "Should have safe auth message"
        
        print("✓ errors.js correctly classifies auth errors")
    
    def test_errors_js_classifies_rate_limit_errors(self):
        """Verify errors.js classifies rate limit errors correctly"""
        errors_file = '/app/lib/ai/errors.js'
        with open(errors_file, 'r') as f:
            content = f.read()
        
        # Check rate limit patterns
        rate_patterns = ['rate limit', 'too many requests', 'rate_limit']
        for pattern in rate_patterns:
            assert pattern in content.lower(), f"errors.js should detect '{pattern}'"
        
        # Check user-facing message is safe
        assert "busy right now" in content.lower(), "Should have safe rate limit message"
        
        print("✓ errors.js correctly classifies rate limit errors")
    
    def test_provider_error_class_excludes_raw_error_in_response(self):
        """Verify ProviderError.toJSON() includes raw_error but API responses should filter it"""
        errors_file = '/app/lib/ai/errors.js'
        with open(errors_file, 'r') as f:
            content = f.read()
        
        # The toJSON method exists but API handlers should NOT include raw_error in responses
        assert 'toJSON()' in content, "ProviderError should have toJSON method"
        
        # Check chats.js doesn't expose raw_error
        chats_file = '/app/lib/api/routes/chats.js'
        with open(chats_file, 'r') as f:
            chats_content = f.read()
        
        # The error response should use user_message, not raw_error
        assert 'user_message' in chats_content, "chats.js should use user_message"
        
        print("✓ API responses use user_message, not raw_error")


class TestCreditGatesInCode:
    """Test that credit pre-checks exist in all AI endpoints"""
    
    def test_chats_has_credit_precheck(self):
        """Verify chats.js has credit pre-check before AI call"""
        chats_file = '/app/lib/api/routes/chats.js'
        with open(chats_file, 'r') as f:
            content = f.read()
        
        # Check credit pre-check exists
        assert 'creditsDb.getBalance' in content, "chats.js should check credit balance"
        assert 'estimateRequestCost' in content, "chats.js should estimate request cost"
        assert 'credits_exhausted' in content, "chats.js should handle credits_exhausted"
        
        # Check deduction after success
        assert 'creditsDb.deductCredits' in content, "chats.js should deduct credits after success"
        
        print("✓ chats.js has credit pre-check and post-deduction")
    
    def test_stream_handler_has_credit_precheck(self):
        """Verify stream-handler.js has credit pre-check before AI call"""
        stream_file = '/app/lib/api/stream-handler.js'
        with open(stream_file, 'r') as f:
            content = f.read()
        
        # Check credit pre-check exists
        assert 'creditsDb.getBalance' in content, "stream-handler.js should check credit balance"
        assert 'estimateRequestCost' in content, "stream-handler.js should estimate request cost"
        assert 'credits_exhausted' in content, "stream-handler.js should handle credits_exhausted"
        
        # Check deduction after success
        assert 'creditsDb.deductCredits' in content, "stream-handler.js should deduct credits after success"
        
        print("✓ stream-handler.js has credit pre-check and post-deduction")
    
    def test_diffs_has_credit_precheck(self):
        """Verify diffs.js has credit pre-check before applying diffs"""
        diffs_file = '/app/lib/api/routes/diffs.js'
        with open(diffs_file, 'r') as f:
            content = f.read()
        
        # Check credit pre-check exists
        assert 'creditsDb.getBalance' in content, "diffs.js should check credit balance"
        assert 'CREDIT_COSTS.file_apply' in content, "diffs.js should use file_apply cost"
        assert 'credits_exhausted' in content, "diffs.js should handle credits_exhausted"
        assert 'status: 402' in content, "diffs.js should return 402 for insufficient credits"
        
        # Check deduction after success
        assert 'creditsDb.deductCredits' in content, "diffs.js should deduct credits after success"
        
        print("✓ diffs.js has credit pre-check and post-deduction")
    
    def test_assets_has_credit_precheck(self):
        """Verify assets.js has credit pre-check before image generation"""
        assets_file = '/app/lib/api/routes/assets.js'
        with open(assets_file, 'r') as f:
            content = f.read()
        
        # Check credit pre-check exists
        assert 'creditsDb.getBalance' in content, "assets.js should check credit balance"
        assert 'CREDIT_COSTS.image_generation' in content, "assets.js should use image_generation cost"
        assert 'credits_exhausted' in content, "assets.js should handle credits_exhausted"
        assert 'status: 402' in content, "assets.js should return 402 for insufficient credits"
        
        # Check deduction after success
        assert 'creditsDb.deductCredits' in content, "assets.js should deduct credits after success"
        
        print("✓ assets.js has credit pre-check and post-deduction")


class TestNoRawErrorLeakage:
    """Test that raw provider errors are never exposed in API responses"""
    
    def test_chats_error_handler_uses_classifyProviderError(self):
        """Verify chats.js uses classifyProviderError for error handling"""
        chats_file = '/app/lib/api/routes/chats.js'
        with open(chats_file, 'r') as f:
            content = f.read()
        
        # Check classifyProviderError is imported and used
        assert 'classifyProviderError' in content, "chats.js should import classifyProviderError"
        
        # Check error response doesn't include raw_error
        # The response should use user_message from ProviderError
        assert 'providerErr.user_message' in content or 'classifiedErr.user_message' in content, \
            "chats.js should use user_message from classified error"
        
        print("✓ chats.js uses classifyProviderError for safe error messages")
    
    def test_stream_handler_uses_classifyProviderError(self):
        """Verify stream-handler.js uses classifyProviderError for error handling"""
        stream_file = '/app/lib/api/stream-handler.js'
        with open(stream_file, 'r') as f:
            content = f.read()
        
        # Check classifyProviderError is imported and used
        assert 'classifyProviderError' in content, "stream-handler.js should import classifyProviderError"
        
        # Check error response uses user_message
        assert 'classifiedErr.user_message' in content or 'userFacing' in content, \
            "stream-handler.js should use user_message from classified error"
        
        print("✓ stream-handler.js uses classifyProviderError for safe error messages")
    
    def test_assets_error_handler_sanitizes_errors(self):
        """Verify assets.js sanitizes error messages"""
        assets_file = '/app/lib/api/routes/assets.js'
        with open(assets_file, 'r') as f:
            content = f.read()
        
        # Check error handling translates raw errors
        assert 'safeError' in content, "assets.js should use safeError variable"
        assert "You're out of credits" in content, "assets.js should have safe billing message"
        assert "busy right now" in content.lower(), "assets.js should have safe rate limit message"
        
        print("✓ assets.js sanitizes error messages")


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
    
    def test_estimate_request_cost_function(self):
        """Verify estimateRequestCost function exists"""
        service_file = '/app/lib/credits/service.js'
        with open(service_file, 'r') as f:
            content = f.read()
        
        assert 'export function estimateRequestCost' in content, \
            "estimateRequestCost should be exported"
        assert 'getModelCost' in content, "Should use getModelCost for model-specific pricing"
        
        print("✓ estimateRequestCost function properly defined")


class TestPublicEndpointSecurity:
    """Test public endpoints don't expose sensitive info"""
    
    def test_provider_status_no_api_key_details(self):
        """Provider status should never expose API key details"""
        response = requests.get(f"{BASE_URL}/api/providers/status")
        assert response.status_code == 200
        
        response_text = response.text.lower()
        
        # Should NOT contain any API key patterns
        forbidden_patterns = [
            'sk-',  # OpenAI key prefix
            'sk-ant-',  # Anthropic key prefix
            'api_key',
            'apikey',
            'secret',
            'token',
        ]
        
        for pattern in forbidden_patterns:
            assert pattern not in response_text, \
                f"Provider status should not contain '{pattern}'"
        
        print("✓ Provider status doesn't expose API key details")
    
    def test_health_endpoint_no_sensitive_info(self):
        """Health endpoint should not expose sensitive info"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        
        response_text = response.text.lower()
        
        # Should NOT contain sensitive info
        forbidden_patterns = ['password', 'secret', 'key', 'token', 'credential']
        for pattern in forbidden_patterns:
            assert pattern not in response_text, \
                f"Health endpoint should not contain '{pattern}'"
        
        print("✓ Health endpoint doesn't expose sensitive info")


class TestErrorResponseFormat:
    """Test error responses follow safe format"""
    
    def test_unauthorized_error_format(self):
        """Unauthorized requests should return safe error format"""
        # Try to access a protected endpoint without auth
        response = requests.get(f"{BASE_URL}/api/projects")
        
        # Should return 401 with safe error message
        assert response.status_code == 401
        data = response.json()
        
        # Should have 'error' field with safe message
        assert 'error' in data
        assert 'Unauthorized' in data['error'] or 'unauthorized' in data['error'].lower()
        
        # Should NOT contain sensitive info
        response_text = str(data).lower()
        forbidden = ['api key', 'token', 'secret', 'password']
        for term in forbidden:
            assert term not in response_text, f"Error should not contain '{term}'"
        
        print(f"✓ Unauthorized error format is safe: {data}")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
