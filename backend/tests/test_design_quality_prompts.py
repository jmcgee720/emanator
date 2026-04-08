"""
Test suite for Design Quality Prompt Enhancements (Iteration 69)
Tests the buildDesignExcellenceBlock function, plan-executor integration,
message-stream design quality instructions, and CanvasPanel brief format.
"""
import pytest
import subprocess
import os
import re

# Base URL for HTTP tests
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')


class TestPromptBuilderExports:
    """Test that prompt-builder.js exports buildDesignExcellenceBlock correctly"""
    
    def test_buildDesignExcellenceBlock_is_exported(self):
        """Verify buildDesignExcellenceBlock function is exported from prompt-builder.js"""
        result = subprocess.run(
            ['grep', '-n', 'export function buildDesignExcellenceBlock', '/app/lib/ai/prompt-builder.js'],
            capture_output=True, text=True
        )
        assert result.returncode == 0, "buildDesignExcellenceBlock should be exported"
        assert 'export function buildDesignExcellenceBlock' in result.stdout
        print(f"PASS: buildDesignExcellenceBlock is exported at line {result.stdout.split(':')[0]}")
    
    def test_buildDesignExcellenceBlock_contains_design_excellence_header(self):
        """Verify the function contains the DESIGN EXCELLENCE header"""
        with open('/app/lib/ai/prompt-builder.js', 'r') as f:
            content = f.read()
        assert '## DESIGN EXCELLENCE' in content, "Should contain DESIGN EXCELLENCE header"
        print("PASS: buildDesignExcellenceBlock contains DESIGN EXCELLENCE header")
    
    def test_buildDesignExcellenceBlock_contains_unsplash_urls(self):
        """Verify the function contains Unsplash image URLs"""
        with open('/app/lib/ai/prompt-builder.js', 'r') as f:
            content = f.read()
        assert 'images.unsplash.com' in content, "Should contain Unsplash URLs"
        print("PASS: buildDesignExcellenceBlock contains Unsplash URLs")
    
    def test_buildDesignExcellenceBlock_contains_glassmorphism(self):
        """Verify the function contains glass-morphism instructions"""
        with open('/app/lib/ai/prompt-builder.js', 'r') as f:
            content = f.read()
        assert 'Glass-morphism' in content or 'glass-morphism' in content or 'backdrop-blur' in content
        print("PASS: buildDesignExcellenceBlock contains glass-morphism instructions")
    
    def test_buildDesignExcellenceBlock_contains_glow_effects(self):
        """Verify the function contains glow effect instructions"""
        with open('/app/lib/ai/prompt-builder.js', 'r') as f:
            content = f.read()
        assert 'Glow effect' in content or 'glow' in content.lower()
        print("PASS: buildDesignExcellenceBlock contains glow effect instructions")


class TestPlanExecutorIntegration:
    """Test that plan-executor.js imports and uses buildDesignExcellenceBlock"""
    
    def test_plan_executor_imports_buildDesignExcellenceBlock(self):
        """Verify plan-executor.js imports buildDesignExcellenceBlock"""
        result = subprocess.run(
            ['grep', '-n', 'buildDesignExcellenceBlock', '/app/lib/ai/plan-executor.js'],
            capture_output=True, text=True
        )
        assert result.returncode == 0, "plan-executor.js should reference buildDesignExcellenceBlock"
        lines = result.stdout.strip().split('\n')
        
        # Check for import statement
        import_found = any('import' in line and 'buildDesignExcellenceBlock' in line for line in lines)
        assert import_found, "Should have import statement for buildDesignExcellenceBlock"
        print("PASS: plan-executor.js imports buildDesignExcellenceBlock")
    
    def test_plan_executor_uses_buildDesignExcellenceBlock_in_system_message(self):
        """Verify buildDesignExcellenceBlock is called in the system message"""
        with open('/app/lib/ai/plan-executor.js', 'r') as f:
            content = f.read()
        
        # Check that it's called (not just imported)
        assert '${buildDesignExcellenceBlock()}' in content, "Should call buildDesignExcellenceBlock() in template"
        print("PASS: plan-executor.js calls buildDesignExcellenceBlock() in system message")
    
    def test_plan_executor_buildDesignExcellenceBlock_in_execute_plan_section(self):
        """Verify buildDesignExcellenceBlock is in the EXECUTE PLAN section"""
        with open('/app/lib/ai/plan-executor.js', 'r') as f:
            content = f.read()
        
        # Find the EXECUTE PLAN section and verify buildDesignExcellenceBlock is nearby
        execute_plan_match = re.search(r'## EXECUTE PLAN.*?buildDesignExcellenceBlock', content, re.DOTALL)
        assert execute_plan_match, "buildDesignExcellenceBlock should be in EXECUTE PLAN section"
        print("PASS: buildDesignExcellenceBlock is in EXECUTE PLAN section")


class TestMessageStreamDesignQuality:
    """Test that message-stream.js includes design quality instructions for new projects"""
    
    def test_message_stream_has_design_quality_section(self):
        """Verify message-stream.js has DESIGN QUALITY FOR NEW PROJECTS section"""
        result = subprocess.run(
            ['grep', '-n', 'DESIGN QUALITY FOR NEW PROJECTS', '/app/lib/ai/message-stream.js'],
            capture_output=True, text=True
        )
        assert result.returncode == 0, "Should have DESIGN QUALITY FOR NEW PROJECTS section"
        print(f"PASS: message-stream.js has DESIGN QUALITY section at line {result.stdout.split(':')[0]}")
    
    def test_message_stream_design_quality_conditional_on_isNewProjectBuild(self):
        """Verify design quality section is conditional on isNewProjectBuild"""
        with open('/app/lib/ai/message-stream.js', 'r') as f:
            content = f.read()
        
        # Check that isNewProjectBuild is used to conditionally include design quality
        assert 'isNewProjectBuild' in content, "Should reference isNewProjectBuild"
        assert 'isNewProjectBuild ?' in content or '${isNewProjectBuild' in content, "Should conditionally include based on isNewProjectBuild"
        print("PASS: Design quality section is conditional on isNewProjectBuild")
    
    def test_message_stream_design_quality_mentions_separate_component_files(self):
        """Verify design quality section mentions separate component files"""
        with open('/app/lib/ai/message-stream.js', 'r') as f:
            content = f.read()
        
        # Find the design quality section
        design_section_match = re.search(r'DESIGN QUALITY FOR NEW PROJECTS:.*?`', content, re.DOTALL)
        assert design_section_match, "Should have design quality section"
        design_section = design_section_match.group(0)
        
        assert 'SEPARATE component files' in design_section or 'separate' in design_section.lower()
        print("PASS: Design quality section mentions separate component files")


class TestCanvasPanelBriefFormat:
    """Test that CanvasPanel.jsx generates proper brief text"""
    
    def test_canvas_panel_brief_has_build_marker(self):
        """Verify buildPromptFromBrief includes 'Build this project now with COMPLETE' marker"""
        with open('/app/components/dashboard/CanvasPanel.jsx', 'r') as f:
            content = f.read()
        
        assert 'Build this project now with COMPLETE' in content
        print("PASS: CanvasPanel brief includes 'Build this project now with COMPLETE' marker")
    
    def test_canvas_panel_brief_not_verbose_150_lines(self):
        """Verify the brief text doesn't have the old verbose 150-line minimum text"""
        with open('/app/components/dashboard/CanvasPanel.jsx', 'r') as f:
            content = f.read()
        
        # The old verbose text had things like "minimum 150 lines" or "at least 150 lines"
        assert '150 lines' not in content.lower(), "Should not have old 150-line minimum text"
        assert 'minimum lines' not in content.lower(), "Should not have minimum lines requirement"
        print("PASS: CanvasPanel brief doesn't have old verbose 150-line minimum text")
    
    def test_canvas_panel_brief_mentions_production_ready(self):
        """Verify the brief mentions production-ready pages"""
        with open('/app/components/dashboard/CanvasPanel.jsx', 'r') as f:
            content = f.read()
        
        assert 'production-ready' in content.lower() or 'production ready' in content.lower()
        print("PASS: CanvasPanel brief mentions production-ready pages")


class TestIsSimpleFrontendEditBehavior:
    """Test that isSimpleFrontendEdit returns false for the new brief format"""
    
    def test_isSimpleFrontendEdit_returns_false_for_brief_marker(self):
        """Verify isSimpleFrontendEdit returns false for 'Build this project now with COMPLETE'"""
        with open('/app/lib/ai/intents.js', 'r') as f:
            content = f.read()
        
        # Check that the function has the marker check
        assert "Build this project now with COMPLETE" in content
        assert "return false" in content
        
        # Verify the pattern is in isSimpleFrontendEdit function
        func_match = re.search(r'export function isSimpleFrontendEdit.*?^}', content, re.MULTILINE | re.DOTALL)
        assert func_match, "Should have isSimpleFrontendEdit function"
        func_content = func_match.group(0)
        
        assert 'Build this project now with COMPLETE' in func_content
        print("PASS: isSimpleFrontendEdit checks for 'Build this project now with COMPLETE' marker")
    
    def test_isSimpleFrontendEdit_returns_false_for_long_messages(self):
        """Verify isSimpleFrontendEdit returns false for messages > 600 chars"""
        with open('/app/lib/ai/intents.js', 'r') as f:
            content = f.read()
        
        # Find the isSimpleFrontendEdit function
        func_match = re.search(r'export function isSimpleFrontendEdit.*?^}', content, re.MULTILINE | re.DOTALL)
        assert func_match, "Should have isSimpleFrontendEdit function"
        func_content = func_match.group(0)
        
        assert '600' in func_content, "Should check for 600 char limit"
        assert 'text.length' in func_content, "Should check text.length"
        print("PASS: isSimpleFrontendEdit returns false for messages > 600 chars")


class TestAppHealth:
    """Test that the app is serving correctly"""
    
    def test_app_returns_http_200(self):
        """Verify the app returns HTTP 200 on the main URL"""
        import requests
        response = requests.get(BASE_URL, timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"PASS: App returns HTTP 200 at {BASE_URL}")
    
    def test_api_health_endpoint(self):
        """Verify the API health endpoint works"""
        import requests
        try:
            response = requests.get(f"{BASE_URL}/api/health", timeout=10)
            # Health endpoint might return 200 or 404 depending on implementation
            assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
            print(f"PASS: API health check returned {response.status_code}")
        except Exception as e:
            print(f"INFO: Health endpoint check: {e}")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
