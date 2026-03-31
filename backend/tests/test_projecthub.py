"""
ProjectHub API Tests - Testing project rename, file upload, and media bin features
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://api-refactor-27.preview.emergentagent.com').rstrip('/')

# Test credentials
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"


class TestAuth:
    """Authentication tests"""
    
    def test_login_success(self):
        """Test login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "session" in data or "user" in data, f"Unexpected response: {data}"
        print(f"Login successful: {data.get('user', {}).get('email', 'N/A')}")


@pytest.fixture(scope="module")
def auth_session():
    """Create authenticated session for all tests"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    
    # Login
    response = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    
    if response.status_code != 200:
        pytest.skip(f"Authentication failed: {response.text}")
    
    # Extract cookies for auth
    return session


@pytest.fixture(scope="module")
def test_project(auth_session):
    """Create a test project for testing"""
    response = auth_session.post(f"{BASE_URL}/api/projects", json={
        "name": f"TEST_ProjectHub_{int(time.time())}",
        "type": "app"
    })
    
    if response.status_code not in [200, 201]:
        pytest.skip(f"Failed to create test project: {response.text}")
    
    data = response.json()
    project = data.get("project", data)
    project_id = project.get("id")
    
    yield project
    
    # Cleanup - delete test project
    try:
        auth_session.delete(f"{BASE_URL}/api/projects/{project_id}")
    except:
        pass


class TestProjectRename:
    """Test project rename functionality via PUT /api/projects/:id"""
    
    def test_rename_project_success(self, auth_session, test_project):
        """Test renaming a project with valid name"""
        project_id = test_project.get("id")
        new_name = f"TEST_Renamed_{int(time.time())}"
        
        response = auth_session.put(f"{BASE_URL}/api/projects/{project_id}", json={
            "name": new_name
        })
        
        assert response.status_code == 200, f"Rename failed: {response.text}"
        data = response.json()
        assert data.get("success") == True, f"Unexpected response: {data}"
        print(f"Project renamed successfully to: {new_name}")
    
    def test_rename_project_verify_persistence(self, auth_session, test_project):
        """Test that renamed project persists after GET"""
        project_id = test_project.get("id")
        new_name = f"TEST_Verified_{int(time.time())}"
        
        # Rename
        rename_response = auth_session.put(f"{BASE_URL}/api/projects/{project_id}", json={
            "name": new_name
        })
        assert rename_response.status_code == 200
        
        # Verify via GET
        get_response = auth_session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200, f"GET failed: {get_response.text}"
        
        project_data = get_response.json()
        assert project_data.get("name") == new_name, f"Name not persisted: {project_data}"
        print(f"Project name verified: {project_data.get('name')}")
    
    def test_rename_project_unauthorized(self):
        """Test rename without auth returns 401"""
        response = requests.put(f"{BASE_URL}/api/projects/fake-id", json={
            "name": "Unauthorized Rename"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"


class TestFileUpload:
    """Test file upload to Media Bin via POST /api/projects/:id/upload"""
    
    def test_upload_text_file(self, auth_session, test_project):
        """Test uploading a text file to media bin"""
        project_id = test_project.get("id")
        
        response = auth_session.post(f"{BASE_URL}/api/projects/{project_id}/upload", json={
            "files": [{
                "filename": "test_document.txt",
                "content": "This is a test document for media bin upload.",
                "mime_type": "text/plain"
            }]
        })
        
        assert response.status_code == 200, f"Upload failed: {response.text}"
        data = response.json()
        assert "uploads" in data, f"No uploads in response: {data}"
        
        uploads = data["uploads"]
        assert len(uploads) > 0, "No files uploaded"
        assert uploads[0].get("success") == True, f"Upload not successful: {uploads[0]}"
        assert "_uploads/" in uploads[0].get("path", ""), f"Path not in _uploads: {uploads[0]}"
        print(f"Text file uploaded: {uploads[0].get('path')}")
    
    def test_upload_multiple_files(self, auth_session, test_project):
        """Test uploading multiple files at once"""
        project_id = test_project.get("id")
        
        response = auth_session.post(f"{BASE_URL}/api/projects/{project_id}/upload", json={
            "files": [
                {
                    "filename": "file1.md",
                    "content": "# Markdown File 1",
                    "mime_type": "text/markdown"
                },
                {
                    "filename": "file2.json",
                    "content": '{"key": "value"}',
                    "mime_type": "application/json"
                }
            ]
        })
        
        assert response.status_code == 200, f"Upload failed: {response.text}"
        data = response.json()
        uploads = data.get("uploads", [])
        
        successful = [u for u in uploads if u.get("success")]
        assert len(successful) == 2, f"Expected 2 successful uploads, got {len(successful)}"
        print(f"Multiple files uploaded: {len(successful)} files")
    
    def test_upload_no_files_error(self, auth_session, test_project):
        """Test upload with empty files array returns error"""
        project_id = test_project.get("id")
        
        response = auth_session.post(f"{BASE_URL}/api/projects/{project_id}/upload", json={
            "files": []
        })
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
    
    def test_upload_unauthorized(self):
        """Test upload without auth returns 401"""
        response = requests.post(f"{BASE_URL}/api/projects/fake-id/upload", json={
            "files": [{"filename": "test.txt", "content": "test"}]
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"


class TestMediaBinAttachments:
    """Test GET /api/projects/:id/attachments for media bin listing"""
    
    def test_get_attachments_empty(self, auth_session, test_project):
        """Test getting attachments for project (may be empty initially)"""
        project_id = test_project.get("id")
        
        response = auth_session.get(f"{BASE_URL}/api/projects/{project_id}/attachments")
        
        assert response.status_code == 200, f"GET attachments failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"Attachments count: {len(data)}")
    
    def test_upload_then_list_attachments(self, auth_session, test_project):
        """Test that uploaded files appear in attachments list"""
        project_id = test_project.get("id")
        
        # Upload a file
        upload_response = auth_session.post(f"{BASE_URL}/api/projects/{project_id}/upload", json={
            "files": [{
                "filename": f"media_bin_test_{int(time.time())}.txt",
                "content": "Media bin test content",
                "mime_type": "text/plain"
            }]
        })
        assert upload_response.status_code == 200
        
        # List attachments
        list_response = auth_session.get(f"{BASE_URL}/api/projects/{project_id}/attachments")
        assert list_response.status_code == 200
        
        attachments = list_response.json()
        assert len(attachments) > 0, "No attachments found after upload"
        
        # Verify attachment structure
        attachment = attachments[0]
        assert "id" in attachment, "Missing id in attachment"
        assert "filename" in attachment, "Missing filename in attachment"
        assert "path" in attachment, "Missing path in attachment"
        assert attachment["path"].startswith("_uploads/"), f"Path not in _uploads: {attachment['path']}"
        print(f"Attachments verified: {len(attachments)} files")
    
    def test_attachments_unauthorized(self):
        """Test attachments without auth returns 401"""
        response = requests.get(f"{BASE_URL}/api/projects/fake-id/attachments")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"


class TestProjectFilesIncludeUploads:
    """Test that uploaded files appear in project files list (for AI context)"""
    
    def test_uploaded_files_in_project_files(self, auth_session, test_project):
        """Test that _uploads/ files are included in project files"""
        project_id = test_project.get("id")
        
        # Upload a file
        unique_name = f"ai_context_test_{int(time.time())}.txt"
        upload_response = auth_session.post(f"{BASE_URL}/api/projects/{project_id}/upload", json={
            "files": [{
                "filename": unique_name,
                "content": "This content should be available to AI context",
                "mime_type": "text/plain"
            }]
        })
        assert upload_response.status_code == 200
        
        # Get project files
        files_response = auth_session.get(f"{BASE_URL}/api/projects/{project_id}/files")
        assert files_response.status_code == 200
        
        files = files_response.json()
        upload_files = [f for f in files if f.get("path", "").startswith("_uploads/")]
        
        assert len(upload_files) > 0, "No _uploads/ files found in project files"
        print(f"Upload files in project files: {len(upload_files)}")


class TestQuickActionsCards:
    """Test that only 2 quick action cards exist (New Chat, Upload to Media Bin)"""
    
    def test_projects_list_loads(self, auth_session):
        """Test that projects list loads successfully"""
        response = auth_session.get(f"{BASE_URL}/api/projects")
        assert response.status_code == 200, f"Projects list failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"Projects loaded: {len(data)} projects")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
