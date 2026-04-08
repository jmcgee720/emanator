"""
Test Aurora Speed Reduction and Preview Snapshot API
Tests for iteration 73:
1. Aurora STATE_CONFIGS speed values verification
2. Preview Snapshot GET/PUT API endpoints
"""

import pytest
import requests
import os
import re

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com')


class TestAuroraSpeedReduction:
    """Verify aurora STATE_CONFIGS have reduced speed values"""
    
    def test_aurora_engine_file_exists_in_lib(self):
        """Check /app/lib/auroraEngine.js exists"""
        assert os.path.exists('/app/lib/auroraEngine.js'), "auroraEngine.js should exist in /app/lib/"
    
    def test_aurora_engine_file_exists_in_frontend(self):
        """Check /app/frontend/src/lib/auroraEngine.js exists"""
        assert os.path.exists('/app/frontend/src/lib/auroraEngine.js'), "auroraEngine.js should exist in /app/frontend/src/lib/"
    
    def test_aurora_idle_speed_reduced(self):
        """Verify idle speed is ~0.06 (reduced from 0.12)"""
        with open('/app/lib/auroraEngine.js', 'r') as f:
            content = f.read()
        
        # Extract idle speed value
        match = re.search(r"idle:\s*\{[^}]*speed:\s*([\d.]+)", content)
        assert match, "Could not find idle speed in STATE_CONFIGS"
        idle_speed = float(match.group(1))
        assert idle_speed == 0.06, f"Idle speed should be 0.06, got {idle_speed}"
    
    def test_aurora_thinking_speed_reduced(self):
        """Verify thinking speed is ~0.12 (reduced from 0.25)"""
        with open('/app/lib/auroraEngine.js', 'r') as f:
            content = f.read()
        
        match = re.search(r"thinking:\s*\{[^}]*speed:\s*([\d.]+)", content)
        assert match, "Could not find thinking speed in STATE_CONFIGS"
        thinking_speed = float(match.group(1))
        assert thinking_speed == 0.12, f"Thinking speed should be 0.12, got {thinking_speed}"
    
    def test_aurora_responding_speed_reduced(self):
        """Verify responding speed is ~0.16 (reduced from 0.32)"""
        with open('/app/lib/auroraEngine.js', 'r') as f:
            content = f.read()
        
        match = re.search(r"responding:\s*\{[^}]*speed:\s*([\d.]+)", content)
        assert match, "Could not find responding speed in STATE_CONFIGS"
        responding_speed = float(match.group(1))
        assert responding_speed == 0.16, f"Responding speed should be 0.16, got {responding_speed}"
    
    def test_aurora_listening_speed_reduced(self):
        """Verify listening speed is ~0.09 (reduced from 0.18)"""
        with open('/app/lib/auroraEngine.js', 'r') as f:
            content = f.read()
        
        match = re.search(r"listening:\s*\{[^}]*speed:\s*([\d.]+)", content)
        assert match, "Could not find listening speed in STATE_CONFIGS"
        listening_speed = float(match.group(1))
        assert listening_speed == 0.09, f"Listening speed should be 0.09, got {listening_speed}"
    
    def test_aurora_files_match(self):
        """Verify both aurora engine files have identical STATE_CONFIGS"""
        with open('/app/lib/auroraEngine.js', 'r') as f:
            lib_content = f.read()
        with open('/app/frontend/src/lib/auroraEngine.js', 'r') as f:
            frontend_content = f.read()
        
        # Extract STATE_CONFIGS block from both files
        lib_match = re.search(r"const STATE_CONFIGS = \{[^}]+\{[^}]+\}[^}]+\{[^}]+\}[^}]+\{[^}]+\}[^}]+\{[^}]+\}[^}]+\{[^}]+\}\s*\};", lib_content)
        frontend_match = re.search(r"const STATE_CONFIGS = \{[^}]+\{[^}]+\}[^}]+\{[^}]+\}[^}]+\{[^}]+\}[^}]+\{[^}]+\}[^}]+\{[^}]+\}\s*\};", frontend_content)
        
        assert lib_match, "Could not extract STATE_CONFIGS from lib/auroraEngine.js"
        assert frontend_match, "Could not extract STATE_CONFIGS from frontend/src/lib/auroraEngine.js"
        
        # Normalize whitespace for comparison
        lib_config = ' '.join(lib_match.group(0).split())
        frontend_config = ' '.join(frontend_match.group(0).split())
        
        assert lib_config == frontend_config, "STATE_CONFIGS should be identical in both files"


class TestPreviewSnapshotAPI:
    """Test preview snapshot GET/PUT endpoints"""
    
    def test_preview_snapshot_route_exists_in_files_js(self):
        """Verify preview-snapshot routes are defined in files.js"""
        with open('/app/lib/api/routes/files.js', 'r') as f:
            content = f.read()
        
        assert 'preview-snapshot' in content, "preview-snapshot route should be defined"
        assert "method === 'GET'" in content, "GET method handler should exist"
        assert "method === 'PUT'" in content, "PUT method handler should exist"
    
    def test_preview_snapshot_get_returns_401_without_auth(self):
        """GET /api/projects/{id}/preview-snapshot should return 401 without auth"""
        response = requests.get(f"{BASE_URL}/api/projects/test-project-id/preview-snapshot")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    
    def test_preview_snapshot_put_returns_401_without_auth(self):
        """PUT /api/projects/{id}/preview-snapshot should return 401 without auth"""
        response = requests.put(
            f"{BASE_URL}/api/projects/test-project-id/preview-snapshot",
            json={"html": "<html></html>", "files_hash": "test-hash"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    
    def test_preview_snapshot_get_handler_checks_project_exists(self):
        """Verify GET handler checks if project exists"""
        with open('/app/lib/api/routes/files.js', 'r') as f:
            content = f.read()
        
        # Check that the GET handler fetches project and returns 404 if not found
        assert "db.projects.findById(projectId)" in content, "Should fetch project by ID"
        assert "status: 404" in content, "Should return 404 if project not found"
    
    def test_preview_snapshot_put_saves_to_settings(self):
        """Verify PUT handler saves snapshot to project.settings"""
        with open('/app/lib/api/routes/files.js', 'r') as f:
            content = f.read()
        
        assert "preview_snapshot:" in content, "Should save to preview_snapshot field"
        assert "files_hash" in content, "Should include files_hash in snapshot"
        assert "saved_at" in content, "Should include saved_at timestamp"
        assert "db.projects.update" in content, "Should call db.projects.update"


class TestPreviewTabSnapshotLogic:
    """Test PreviewTab component snapshot implementation"""
    
    def test_preview_tab_has_snapshot_state(self):
        """Verify PreviewTab has snapshotHtml state"""
        with open('/app/components/dashboard/tabs/PreviewTab.jsx', 'r') as f:
            content = f.read()
        
        assert "const [snapshotHtml, setSnapshotHtml] = useState(null)" in content, \
            "PreviewTab should have snapshotHtml state"
    
    def test_preview_tab_has_files_content_hash(self):
        """Verify PreviewTab computes filesContentHash"""
        with open('/app/components/dashboard/tabs/PreviewTab.jsx', 'r') as f:
            content = f.read()
        
        assert "filesContentHash" in content, "PreviewTab should compute filesContentHash"
        assert "useMemo" in content, "filesContentHash should use useMemo"
    
    def test_preview_tab_loads_snapshot_on_mount(self):
        """Verify PreviewTab loads snapshot on project entry"""
        with open('/app/components/dashboard/tabs/PreviewTab.jsx', 'r') as f:
            content = f.read()
        
        assert "/api/projects/${project.id}/preview-snapshot" in content or \
               "`/api/projects/${project.id}/preview-snapshot`" in content, \
            "PreviewTab should fetch snapshot on mount"
    
    def test_preview_tab_saves_snapshot_after_compile(self):
        """Verify PreviewTab saves snapshot after compilation"""
        with open('/app/components/dashboard/tabs/PreviewTab.jsx', 'r') as f:
            content = f.read()
        
        # Check for PUT request to save snapshot
        assert "method: 'PUT'" in content, "PreviewTab should PUT snapshot after compile"
        assert "files_hash: filesContentHash" in content, "Should include files_hash in save"
    
    def test_preview_tab_clears_snapshot_on_refresh(self):
        """Verify handleRefresh clears snapshot"""
        with open('/app/components/dashboard/tabs/PreviewTab.jsx', 'r') as f:
            content = f.read()
        
        # Check handleRefresh function clears snapshot
        assert "setSnapshotHtml(null)" in content, "handleRefresh should clear snapshotHtml"
        assert "forceRecompileRef.current = true" in content, "handleRefresh should set forceRecompile"
    
    def test_preview_tab_clears_snapshot_on_live_stream(self):
        """Verify snapshot is cleared when live streaming starts"""
        with open('/app/components/dashboard/tabs/PreviewTab.jsx', 'r') as f:
            content = f.read()
        
        # Check that live streaming clears snapshot
        assert "livePreviewData" in content, "Should handle livePreviewData"
        # The code should clear snapshot when streaming starts
        lines = content.split('\n')
        found_clear_on_stream = False
        for i, line in enumerate(lines):
            if 'livePreviewData' in line and 'setSnapshotHtml(null)' in '\n'.join(lines[max(0,i-5):i+10]):
                found_clear_on_stream = True
                break
        assert found_clear_on_stream, "Should clear snapshot when live streaming starts"
    
    def test_preview_tab_uses_snapshot_if_hash_matches(self):
        """Verify PreviewTab uses cached snapshot if files_hash matches"""
        with open('/app/components/dashboard/tabs/PreviewTab.jsx', 'r') as f:
            content = f.read()
        
        assert "files_hash === filesContentHash" in content or \
               "data.snapshot.files_hash === filesContentHash" in content, \
            "Should check if files_hash matches before using snapshot"


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.status_code}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
