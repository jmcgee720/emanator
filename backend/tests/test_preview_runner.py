"""
Preview Runner API Tests
Tests for POST /api/preview/start, GET /api/preview/status/{project_id}, 
POST /api/preview/stop/{project_id}, GET /api/preview/serve/{project_id}/
"""
import pytest
import requests
import os
import time
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# ─── Test Fixtures ───────────────────────────────────────────────────

@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture
def unique_project_id():
    """Generate unique project ID for each test"""
    return f"test_preview_{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
def cleanup_preview(api_client, unique_project_id):
    """Cleanup preview after each test"""
    yield
    # Stop any running preview
    try:
        api_client.post(f"{BASE_URL}/api/preview/stop/{unique_project_id}")
    except:
        pass


# ─── Static HTML Project Tests ───────────────────────────────────────

class TestStaticHTMLPreview:
    """Tests for static HTML project preview"""
    
    def test_start_static_html_returns_running(self, api_client, unique_project_id):
        """POST /api/preview/start with static HTML files returns status 'running' and type 'static'"""
        payload = {
            "project_id": unique_project_id,
            "files": [
                {"path": "index.html", "content": "<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>"}
            ]
        }
        response = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data.get("status") == "running", f"Expected status 'running', got {data.get('status')}"
        assert data.get("type") == "static", f"Expected type 'static', got {data.get('type')}"
        assert "port" in data, "Response should include port"
        assert data.get("project_id") == unique_project_id
        print(f"✓ Static HTML preview started: status={data['status']}, type={data['type']}, port={data['port']}")
    
    def test_static_html_status_returns_running(self, api_client, unique_project_id):
        """GET /api/preview/status/{project_id} returns correct status for static HTML"""
        # First start the preview
        payload = {
            "project_id": unique_project_id,
            "files": [
                {"path": "index.html", "content": "<!DOCTYPE html><html><body>Test</body></html>"}
            ]
        }
        start_resp = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        assert start_resp.status_code == 200
        
        # Check status
        status_resp = api_client.get(f"{BASE_URL}/api/preview/status/{unique_project_id}")
        assert status_resp.status_code == 200
        data = status_resp.json()
        
        assert data.get("status") == "running"
        assert data.get("type") == "static"
        assert "port" in data
        assert "logs" in data
        print(f"✓ Static HTML status check: status={data['status']}, type={data['type']}")
    
    def test_static_html_serve_returns_content(self, api_client, unique_project_id):
        """GET /api/preview/serve/{project_id}/ proxies content from the running preview server"""
        html_content = "<!DOCTYPE html><html><body><h1>Served Content Test</h1></body></html>"
        payload = {
            "project_id": unique_project_id,
            "files": [
                {"path": "index.html", "content": html_content}
            ]
        }
        start_resp = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        assert start_resp.status_code == 200
        
        # Wait for server to be ready
        time.sleep(1)
        
        # Serve the content
        serve_resp = api_client.get(f"{BASE_URL}/api/preview/serve/{unique_project_id}/")
        assert serve_resp.status_code == 200, f"Expected 200, got {serve_resp.status_code}: {serve_resp.text}"
        
        # Check content is served
        assert "Served Content Test" in serve_resp.text or "text/html" in serve_resp.headers.get("content-type", "")
        print(f"✓ Static HTML content served successfully")


# ─── Node.js Project Tests ───────────────────────────────────────────

class TestNodeJSPreview:
    """Tests for Node.js project preview"""
    
    def test_start_nodejs_returns_installing(self, api_client, unique_project_id):
        """POST /api/preview/start with Node.js files (package.json + server.js) returns status 'installing' and type 'node'"""
        payload = {
            "project_id": unique_project_id,
            "files": [
                {
                    "path": "package.json",
                    "content": '{"name":"test-app","version":"1.0.0","scripts":{"start":"node server.js"},"dependencies":{"express":"^4.18.2"}}'
                },
                {
                    "path": "server.js",
                    "content": '''const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Hello from Node!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));'''
                }
            ]
        }
        response = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data.get("type") == "node", f"Expected type 'node', got {data.get('type')}"
        assert data.get("status") in ["installing", "starting", "running"], f"Expected status 'installing/starting/running', got {data.get('status')}"
        assert "port" in data, "Response should include port"
        print(f"✓ Node.js preview started: status={data['status']}, type={data['type']}, port={data['port']}")
    
    def test_nodejs_status_shows_logs(self, api_client, unique_project_id):
        """GET /api/preview/status/{project_id} returns logs for Node.js project"""
        payload = {
            "project_id": unique_project_id,
            "files": [
                {
                    "path": "package.json",
                    "content": '{"name":"test-app","version":"1.0.0","scripts":{"start":"node server.js"},"dependencies":{"express":"^4.18.2"}}'
                },
                {
                    "path": "server.js",
                    "content": '''const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Hello!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));'''
                }
            ]
        }
        start_resp = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        assert start_resp.status_code == 200
        
        # Wait a bit for npm install to start
        time.sleep(2)
        
        # Check status
        status_resp = api_client.get(f"{BASE_URL}/api/preview/status/{unique_project_id}")
        assert status_resp.status_code == 200
        data = status_resp.json()
        
        assert "status" in data
        assert "type" in data
        assert "logs" in data
        assert isinstance(data["logs"], list)
        print(f"✓ Node.js status check: status={data['status']}, logs_count={len(data['logs'])}")


# ─── Error Handling Tests ────────────────────────────────────────────

class TestPreviewErrorHandling:
    """Tests for error handling in preview endpoints"""
    
    def test_status_nonexistent_project_returns_none(self, api_client):
        """GET /api/preview/status/{project_id} for non-existent project returns status 'none'"""
        response = api_client.get(f"{BASE_URL}/api/preview/status/nonexistent_project_12345")
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "none", f"Expected status 'none', got {data.get('status')}"
        assert data.get("logs") == [], f"Expected empty logs, got {data.get('logs')}"
        print(f"✓ Non-existent project returns status 'none'")
    
    def test_start_empty_files_returns_error(self, api_client, unique_project_id):
        """POST /api/preview/start with empty files returns error"""
        payload = {
            "project_id": unique_project_id,
            "files": []
        }
        response = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "error" in data
        print(f"✓ Empty files returns error: {data.get('error')}")
    
    def test_start_without_project_id_returns_error(self, api_client):
        """POST /api/preview/start without project_id returns error"""
        payload = {
            "files": [
                {"path": "index.html", "content": "<html></html>"}
            ]
        }
        response = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "error" in data
        print(f"✓ Missing project_id returns error: {data.get('error')}")
    
    def test_start_no_html_or_package_json_returns_error(self, api_client, unique_project_id):
        """POST /api/preview/start without index.html or package.json returns error"""
        payload = {
            "project_id": unique_project_id,
            "files": [
                {"path": "readme.txt", "content": "This is a readme file"}
            ]
        }
        response = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "error" in data
        print(f"✓ No index.html/package.json returns error: {data.get('error')}")


# ─── Stop Preview Tests ──────────────────────────────────────────────

class TestStopPreview:
    """Tests for stopping preview"""
    
    def test_stop_running_preview(self, api_client, unique_project_id):
        """POST /api/preview/stop/{project_id} stops the running preview"""
        # Start a preview first
        payload = {
            "project_id": unique_project_id,
            "files": [
                {"path": "index.html", "content": "<!DOCTYPE html><html><body>Test</body></html>"}
            ]
        }
        start_resp = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        assert start_resp.status_code == 200
        
        # Stop the preview
        stop_resp = api_client.post(f"{BASE_URL}/api/preview/stop/{unique_project_id}")
        assert stop_resp.status_code == 200
        data = stop_resp.json()
        assert data.get("status") == "stopped"
        
        # Verify it's stopped
        status_resp = api_client.get(f"{BASE_URL}/api/preview/status/{unique_project_id}")
        status_data = status_resp.json()
        assert status_data.get("status") in ["none", "stopped"]
        print(f"✓ Preview stopped successfully")
    
    def test_stop_nonexistent_preview(self, api_client):
        """POST /api/preview/stop/{project_id} for non-existent project returns not_running"""
        response = api_client.post(f"{BASE_URL}/api/preview/stop/nonexistent_project_xyz")
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "not_running"
        print(f"✓ Stop non-existent preview returns 'not_running'")


# ─── Concurrent Preview Tests ────────────────────────────────────────

class TestConcurrentPreviews:
    """Tests for concurrent preview handling"""
    
    def test_only_one_concurrent_preview_allowed(self, api_client):
        """Only 1 concurrent preview is allowed (starting a new one stops the old)"""
        project_id_1 = f"test_preview_{uuid.uuid4().hex[:8]}"
        project_id_2 = f"test_preview_{uuid.uuid4().hex[:8]}"
        
        try:
            # Start first preview
            payload_1 = {
                "project_id": project_id_1,
                "files": [
                    {"path": "index.html", "content": "<!DOCTYPE html><html><body>Project 1</body></html>"}
                ]
            }
            resp_1 = api_client.post(f"{BASE_URL}/api/preview/start", json=payload_1)
            assert resp_1.status_code == 200
            
            # Verify first is running
            status_1 = api_client.get(f"{BASE_URL}/api/preview/status/{project_id_1}")
            assert status_1.json().get("status") == "running"
            
            # Start second preview
            payload_2 = {
                "project_id": project_id_2,
                "files": [
                    {"path": "index.html", "content": "<!DOCTYPE html><html><body>Project 2</body></html>"}
                ]
            }
            resp_2 = api_client.post(f"{BASE_URL}/api/preview/start", json=payload_2)
            assert resp_2.status_code == 200
            
            # Verify second is running
            status_2 = api_client.get(f"{BASE_URL}/api/preview/status/{project_id_2}")
            assert status_2.json().get("status") == "running"
            
            # Verify first is stopped (only 1 concurrent allowed)
            status_1_after = api_client.get(f"{BASE_URL}/api/preview/status/{project_id_1}")
            assert status_1_after.json().get("status") in ["none", "stopped"], \
                f"Expected first preview to be stopped, got {status_1_after.json().get('status')}"
            
            print(f"✓ Only 1 concurrent preview allowed - old preview stopped when new one started")
        finally:
            # Cleanup
            api_client.post(f"{BASE_URL}/api/preview/stop/{project_id_1}")
            api_client.post(f"{BASE_URL}/api/preview/stop/{project_id_2}")


# ─── Serve Proxy Tests ───────────────────────────────────────────────

class TestServeProxy:
    """Tests for preview serve proxy endpoint"""
    
    def test_serve_nonexistent_project_returns_404(self, api_client):
        """GET /api/preview/serve/{project_id}/ for non-existent project returns 404"""
        response = api_client.get(f"{BASE_URL}/api/preview/serve/nonexistent_project_abc/")
        
        assert response.status_code == 404
        data = response.json()
        assert "error" in data
        print(f"✓ Serve non-existent project returns 404")
    
    def test_serve_subpath(self, api_client, unique_project_id):
        """GET /api/preview/serve/{project_id}/{path} serves subpaths"""
        payload = {
            "project_id": unique_project_id,
            "files": [
                {"path": "index.html", "content": "<!DOCTYPE html><html><body>Index</body></html>"},
                {"path": "about.html", "content": "<!DOCTYPE html><html><body>About Page</body></html>"}
            ]
        }
        start_resp = api_client.post(f"{BASE_URL}/api/preview/start", json=payload)
        assert start_resp.status_code == 200
        
        time.sleep(1)
        
        # Serve subpath
        serve_resp = api_client.get(f"{BASE_URL}/api/preview/serve/{unique_project_id}/about.html")
        assert serve_resp.status_code == 200
        assert "About Page" in serve_resp.text
        print(f"✓ Subpath served successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
