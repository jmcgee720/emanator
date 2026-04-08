"""
Unit tests for isSimpleFrontendEdit() and classifyIntent() functions in intents.js
Tests the fix for Creative Brief prompts being incorrectly classified as simple frontend edits.

Bug: isSimpleFrontendEdit() was returning TRUE for Creative Brief prompts, causing
directEditMode=true and bypassing the multi-file propose_plan flow.

Fix: Added three checks:
1. Explicit marker check: 'Build this project now with COMPLETE' returns FALSE
2. Length check: >600 chars returns FALSE
3. COMPLEX_DISQUALIFIERS: 'production-ready pages', 'SEPARATE COMPONENT FILES', 'Pages needed'
"""

import pytest
import subprocess
import json
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')


class TestIsSimpleFrontendEdit:
    """Tests for isSimpleFrontendEdit() function"""
    
    def run_node_test(self, test_code):
        """Helper to run Node.js code and return result"""
        full_code = f"""
import('./lib/ai/intents.js').then(mod => {{
    {test_code}
}}).catch(e => console.error('ERROR:', e.message));
"""
        result = subprocess.run(
            ['node', '-e', full_code],
            cwd='/app',
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.stdout.strip(), result.stderr
    
    def test_creative_brief_prompt_returns_false(self):
        """Creative Brief prompts with marker should return FALSE"""
        test_code = """
const briefPrompt = 'Build this project now with COMPLETE, production-ready pages. Every page MUST have at least 5 distinct sections. Project: A SaaS landing page.';
const result = mod.isSimpleFrontendEdit(briefPrompt);
console.log(JSON.stringify({ result, expected: false, pass: result === false }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == False, f"Creative Brief prompt should return FALSE, got {data['result']}"
        assert data['pass'] == True
    
    def test_long_message_returns_false(self):
        """Messages >600 chars should return FALSE even without brief marker"""
        test_code = """
const longMsg = 'build a landing page ' + 'a'.repeat(600);
const result = mod.isSimpleFrontendEdit(longMsg);
console.log(JSON.stringify({ result, expected: false, length: longMsg.length, pass: result === false }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == False, f"Long message ({data['length']} chars) should return FALSE"
        assert data['pass'] == True
    
    def test_simple_landing_page_returns_true(self):
        """Simple 'build a landing page' should return TRUE"""
        test_code = """
const simpleMsg = 'build a landing page';
const result = mod.isSimpleFrontendEdit(simpleMsg);
console.log(JSON.stringify({ result, expected: true, pass: result === true }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == True, f"Simple landing page request should return TRUE, got {data['result']}"
        assert data['pass'] == True
    
    def test_simple_dashboard_returns_true(self):
        """Simple 'build a simple dashboard' should return TRUE"""
        test_code = """
const simpleMsg = 'build a simple dashboard';
const result = mod.isSimpleFrontendEdit(simpleMsg);
console.log(JSON.stringify({ result, expected: true, pass: result === true }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == True, f"Simple dashboard request should return TRUE, got {data['result']}"
        assert data['pass'] == True
    
    def test_production_ready_pages_disqualifier(self):
        """COMPLEX_DISQUALIFIERS: 'production-ready pages' should return FALSE"""
        test_code = """
const msg = 'build a page with production-ready pages';
const result = mod.isSimpleFrontendEdit(msg);
console.log(JSON.stringify({ result, expected: false, pass: result === false }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == False, f"'production-ready pages' should disqualify, got {data['result']}"
        assert data['pass'] == True
    
    def test_separate_component_files_disqualifier(self):
        """COMPLEX_DISQUALIFIERS: 'SEPARATE COMPONENT FILES' should return FALSE"""
        test_code = """
const msg = 'build a page with SEPARATE COMPONENT FILES';
const result = mod.isSimpleFrontendEdit(msg);
console.log(JSON.stringify({ result, expected: false, pass: result === false }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == False, f"'SEPARATE COMPONENT FILES' should disqualify, got {data['result']}"
        assert data['pass'] == True
    
    def test_pages_needed_disqualifier(self):
        """COMPLEX_DISQUALIFIERS: 'Pages needed' should return FALSE"""
        test_code = """
const msg = 'build a site with Pages needed: Home, About';
const result = mod.isSimpleFrontendEdit(msg);
console.log(JSON.stringify({ result, expected: false, pass: result === false }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == False, f"'Pages needed' should disqualify, got {data['result']}"
        assert data['pass'] == True


class TestClassifyIntent:
    """Tests for classifyIntent() function"""
    
    def run_node_test(self, test_code):
        """Helper to run Node.js code and return result"""
        full_code = f"""
import('./lib/ai/intents.js').then(mod => {{
    {test_code}
}}).catch(e => console.error('ERROR:', e.message));
"""
        result = subprocess.run(
            ['node', '-e', full_code],
            cwd='/app',
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.stdout.strip(), result.stderr
    
    def test_creative_brief_classified_as_build(self):
        """Creative Brief prompts should be classified as 'build' intent"""
        test_code = """
const briefPrompt = 'Build this project now with COMPLETE, production-ready pages. Every page MUST have at least 5 distinct sections. Project: A SaaS landing page.';
const result = mod.classifyIntent(briefPrompt);
console.log(JSON.stringify({ result, expected: 'build', pass: result === 'build' }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == 'build', f"Creative Brief should classify as 'build', got {data['result']}"
        assert data['pass'] == True
    
    def test_simple_landing_page_classified_as_build(self):
        """Simple landing page request should be classified as 'build' intent"""
        test_code = """
const simpleMsg = 'build a landing page';
const result = mod.classifyIntent(simpleMsg);
console.log(JSON.stringify({ result, expected: 'build', pass: result === 'build' }));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        assert data['result'] == 'build', f"Simple landing page should classify as 'build', got {data['result']}"
        assert data['pass'] == True


class TestFullBriefPrompt:
    """Tests for full Creative Brief prompt format from CanvasPanel.jsx"""
    
    def run_node_test(self, test_code):
        """Helper to run Node.js code and return result"""
        full_code = f"""
import('./lib/ai/intents.js').then(mod => {{
    {test_code}
}}).catch(e => console.error('ERROR:', e.message));
"""
        result = subprocess.run(
            ['node', '-e', full_code],
            cwd='/app',
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.stdout.strip(), result.stderr
    
    def test_full_brief_prompt_not_simple_edit(self):
        """Full Creative Brief prompt (as generated by buildPromptFromBrief) should NOT be simple edit"""
        test_code = """
// Simulating buildPromptFromBrief output
const fullBrief = `Build this project now with COMPLETE, production-ready pages. Every page MUST have at least 5 distinct sections (nav, hero, 3+ content sections, footer). Each section must have real content — not placeholders. Use rich Tailwind CSS styling with gradients, shadows, and responsive layouts. Each component file must be 150+ lines minimum.
Project: A SaaS landing page for a project management tool
Target audience: Freelance designers and developers
Primary goal: Generate leads
Brand name: FlowTask
Style/mood: Professional, Minimal
Colors: Dark theme with electric blue accents
Pages needed (CREATE SEPARATE COMPONENT FILES FOR EACH): Home, About, Pricing, Features
Most important page (build with the most detail and content): Home
Must-have features (implement ALL of these): Email signup form, animated hero section, pricing table`;

const isSimple = mod.isSimpleFrontendEdit(fullBrief);
const intent = mod.classifyIntent(fullBrief);
console.log(JSON.stringify({ 
    isSimpleFrontendEdit: isSimple, 
    classifyIntent: intent,
    length: fullBrief.length,
    hasMarker: fullBrief.includes('Build this project now with COMPLETE'),
    hasPagesNeeded: fullBrief.includes('Pages needed'),
    pass: isSimple === false && intent === 'build'
}));
"""
        stdout, _ = self.run_node_test(test_code)
        data = json.loads(stdout)
        
        assert data['isSimpleFrontendEdit'] == False, f"Full brief should NOT be simple edit, got {data['isSimpleFrontendEdit']}"
        assert data['classifyIntent'] == 'build', f"Full brief should classify as 'build', got {data['classifyIntent']}"
        assert data['hasMarker'] == True, "Brief should contain the marker"
        assert data['hasPagesNeeded'] == True, "Brief should contain 'Pages needed'"
        assert data['pass'] == True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
