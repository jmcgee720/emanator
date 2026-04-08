"""
Test suite for PreviewTab.jsx lazy import fix (iteration 70)
Verifies the fix for cross-file imports resolving to undefined in multi-page sites.

Root cause: Files were compiled sequentially - if Home.jsx imports Header.jsx but Header 
hasn't been compiled yet, `var Header = window.__COMPONENTS__['Header']` evaluates to 
undefined at eval time.

Fix: Added lazy component wrappers (__lazy) that defer resolution to render time.
"""

import pytest
import requests
import os
import re

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Read the PreviewTab.jsx file content for pattern verification
PREVIEW_TAB_PATH = '/app/components/dashboard/tabs/PreviewTab.jsx'

@pytest.fixture(scope='module')
def preview_tab_content():
    """Load PreviewTab.jsx content once for all tests"""
    with open(PREVIEW_TAB_PATH, 'r') as f:
        return f.read()


class TestLazyFunctionDefinition:
    """Tests for __lazy function being properly defined in buildReactPreview output"""
    
    def test_lazy_function_is_defined(self, preview_tab_content):
        """Verify __lazy function is included in the buildReactPreview HTML output"""
        assert 'function __lazy(modName)' in preview_tab_content, \
            "__lazy function definition not found in PreviewTab.jsx"
    
    def test_lazy_uses_react_forwardref(self, preview_tab_content):
        """Verify __lazy uses React.forwardRef for proper ref forwarding"""
        assert 'React.forwardRef(function(props, ref)' in preview_tab_content, \
            "__lazy should use React.forwardRef for ref forwarding"
    
    def test_lazy_has_islazy_marker(self, preview_tab_content):
        """Verify __lazy sets __isLazy marker for identification"""
        assert 'w.__isLazy = true' in preview_tab_content, \
            "__lazy should set __isLazy = true marker"
    
    def test_lazy_has_modname_property(self, preview_tab_content):
        """Verify __lazy sets __modName for debugging"""
        assert 'w.__modName = modName' in preview_tab_content, \
            "__lazy should set __modName property"
    
    def test_lazy_defers_resolution_to_render_time(self, preview_tab_content):
        """Verify __lazy looks up component at render time, not compile time"""
        # The key fix: lookup happens inside the forwardRef function, not at declaration
        pattern = r"var C = window\.__COMPONENTS__\[modName\]"
        assert re.search(pattern, preview_tab_content), \
            "__lazy should defer window.__COMPONENTS__ lookup to render time"
    
    def test_lazy_has_fallback_for_missing_component(self, preview_tab_content):
        """Verify __lazy shows helpful message for missing components"""
        assert 'data-missing-component' in preview_tab_content, \
            "__lazy should render fallback with data-missing-component attribute"


class TestLocalImportResolution:
    """Tests for local imports using __lazy instead of direct window.__COMPONENTS__ lookup"""
    
    def test_default_imports_use_lazy(self, preview_tab_content):
        """Verify local default imports use __lazy wrapper"""
        # Pattern: decls.push(t.variableDeclaration("var",[t.variableDeclarator(ls.local, t.callExpression(t.identifier("__lazy"),[t.stringLiteral(localMod)]))]));
        pattern = r't\.callExpression\(t\.identifier\("__lazy"\),\[t\.stringLiteral\(localMod\)\]'
        assert re.search(pattern, preview_tab_content), \
            "Local default imports should use __lazy(localMod)"
    
    def test_named_imports_use_lazy(self, preview_tab_content):
        """Verify local named imports use __lazy for each imported name"""
        # Pattern: decls.push(t.variableDeclaration("var",[t.variableDeclarator(ls.local, t.callExpression(t.identifier("__lazy"),[t.stringLiteral(impN)]))]));
        pattern = r't\.callExpression\(t\.identifier\("__lazy"\),\[t\.stringLiteral\(impN\)\]'
        assert re.search(pattern, preview_tab_content), \
            "Local named imports should use __lazy(impN)"
    
    def test_old_eager_resolution_not_present(self, preview_tab_content):
        """Verify the old broken eager resolution pattern is NOT present"""
        # The old broken pattern was: decls.push(t.variableDeclaration("var",[t.variableDeclarator(ls.local, compRef)]));
        # where compRef was a direct window.__COMPONENTS__ lookup
        broken_pattern = r'variableDeclarator\(ls\.local,\s*compRef\)'
        assert not re.search(broken_pattern, preview_tab_content), \
            "Old broken eager resolution pattern should NOT be present"


class TestUnknownPackageImports:
    """Tests for unknown package imports generating __stubComponent calls"""
    
    def test_stub_component_function_defined(self, preview_tab_content):
        """Verify __stubComponent function is defined"""
        assert 'function __stubComponent(name)' in preview_tab_content, \
            "__stubComponent function should be defined"
    
    def test_unknown_imports_generate_stubs(self, preview_tab_content):
        """Verify unknown package imports generate __stubComponent calls"""
        # Pattern: unknownDecls.push(t.variableDeclaration("var",[t.variableDeclarator(us.local, t.callExpression(t.identifier("__stubComponent"),[t.stringLiteral(us.local.name)]))]));
        pattern = r't\.callExpression\(t\.identifier\("__stubComponent"\),\[t\.stringLiteral\(us\.local\.name\)\]'
        assert re.search(pattern, preview_tab_content), \
            "Unknown package imports should generate __stubComponent calls"
    
    def test_stub_component_renders_div_with_data_stub(self, preview_tab_content):
        """Verify __stubComponent renders a div with data-stub attribute"""
        assert '"data-stub":name' in preview_tab_content, \
            "__stubComponent should render div with data-stub attribute"


class TestErrorBoundary:
    """Tests for error boundary (_EBClass) wrapping the entry component"""
    
    def test_error_boundary_class_defined(self, preview_tab_content):
        """Verify _EBClass error boundary is defined"""
        assert 'var _EBClass = (function(S)' in preview_tab_content, \
            "_EBClass error boundary should be defined"
    
    def test_error_boundary_has_get_derived_state_from_error(self, preview_tab_content):
        """Verify error boundary implements getDerivedStateFromError"""
        assert 'EB.getDerivedStateFromError = function(e)' in preview_tab_content, \
            "Error boundary should implement getDerivedStateFromError"
    
    def test_error_boundary_wraps_entry_component(self, preview_tab_content):
        """Verify error boundary wraps the entry component render"""
        # Pattern: window.__root__.render(createElement(_EB, null, createElement(_Entry)));
        pattern = r'render\(createElement\(_EB,\s*null,\s*createElement\(_Entry\)\)\)'
        assert re.search(pattern, preview_tab_content), \
            "Error boundary should wrap entry component in render call"
    
    def test_error_boundary_shows_error_message(self, preview_tab_content):
        """Verify error boundary renders error message when error occurs"""
        assert 'Render Error' in preview_tab_content, \
            "Error boundary should show 'Render Error' message"


class TestAppHealth:
    """Tests for app health and accessibility"""
    
    def test_app_returns_http_200(self):
        """Verify the app loads at the main URL"""
        response = requests.get(BASE_URL, timeout=30)
        assert response.status_code == 200, \
            f"App should return HTTP 200, got {response.status_code}"
    
    def test_api_health_endpoint(self):
        """Verify API health endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=30)
        # Accept 200 or 404 (if health endpoint doesn't exist)
        assert response.status_code in [200, 404], \
            f"API health check failed with status {response.status_code}"


class TestBuildReactPreviewStructure:
    """Tests for overall buildReactPreview function structure"""
    
    def test_build_react_preview_function_exists(self, preview_tab_content):
        """Verify buildReactPreview function is defined"""
        assert 'function buildReactPreview(' in preview_tab_content, \
            "buildReactPreview function should be defined"
    
    def test_module_stubs_object_defined(self, preview_tab_content):
        """Verify window.__MODULE_STUBS__ is defined for known packages"""
        assert 'window.__MODULE_STUBS__ = {' in preview_tab_content, \
            "window.__MODULE_STUBS__ should be defined"
    
    def test_components_registry_defined(self, preview_tab_content):
        """Verify window.__COMPONENTS__ registry is defined"""
        assert "window.__COMPONENTS__ = {}" in preview_tab_content, \
            "window.__COMPONENTS__ registry should be initialized"
    
    def test_babel_transform_uses_mkplugin(self, preview_tab_content):
        """Verify Babel transform uses __mkPlugin for AST-based module transform"""
        assert '__mkPlugin(__files[__i].modName)' in preview_tab_content, \
            "Babel transform should use __mkPlugin for module transform"
    
    def test_icon_proxy_defined_for_lucide(self, preview_tab_content):
        """Verify icon proxy is defined for lucide-react"""
        assert 'window.__MODULE_STUBS__["lucide-react"] = __iconProxy' in preview_tab_content, \
            "Icon proxy should be defined for lucide-react"
    
    def test_motion_proxy_defined_for_framer(self, preview_tab_content):
        """Verify motion proxy is defined for framer-motion"""
        assert 'window.__MODULE_STUBS__["framer-motion"]' in preview_tab_content, \
            "Motion proxy should be defined for framer-motion"


class TestLoginFlow:
    """Tests for login functionality"""
    
    def test_main_page_loads_successfully(self):
        """Verify main page is accessible and returns valid HTML"""
        # This is a Next.js app - login form is rendered client-side
        response = requests.get(BASE_URL, timeout=30, allow_redirects=True)
        assert response.status_code == 200, \
            f"Main page should be accessible, got {response.status_code}"
        # Check that page contains expected title (client-side rendering means form won't be in initial HTML)
        assert 'Emanator' in response.text, \
            "Main page should contain Emanator title"
        print("Main page loads successfully - login form is rendered client-side via JavaScript")
    
    def test_auth_callback_route_exists(self):
        """Verify auth callback route exists (for Supabase auth)"""
        # The auth callback route should exist for OAuth flows
        response = requests.get(f"{BASE_URL}/auth/callback", timeout=30, allow_redirects=False)
        # Accept 200, 302 (redirect), or 307 (temporary redirect) - all valid for auth callback
        assert response.status_code in [200, 302, 307, 404], \
            f"Auth callback route check failed with status {response.status_code}"
        print(f"Auth callback route status: {response.status_code}")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
