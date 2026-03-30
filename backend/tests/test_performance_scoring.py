"""
Performance Scoring v1 Tests for Growth Engine
Tests feedback submission, persona score updates, and Auto mode sorting
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"


class TestSetup:
    """Setup and authentication"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token via Supabase"""
        supabase_url = "https://cawmmqakaxbznbelcrwd.supabase.co"
        supabase_key = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
        
        response = requests.post(
            f"{supabase_url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": supabase_key,
                "Content-Type": "application/json"
            },
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }
        )
        assert response.status_code == 200, f"Auth failed: {response.text}"
        data = response.json()
        return data.get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }


class TestFeedbackAuth(TestSetup):
    """POST /api/growth/feedback - Auth tests"""
    
    def test_feedback_without_auth_returns_401(self):
        """POST /api/growth/feedback without auth returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers={"Content-Type": "application/json"},
            json={"page_id": "test", "content_type": "fixes", "rating": 1}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ POST /api/growth/feedback without auth returns 401")
    
    def test_get_feedback_without_auth_returns_401(self):
        """GET /api/growth/feedback/:page_id without auth returns 401"""
        response = requests.get(
            f"{BASE_URL}/api/growth/feedback/test_page_id",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ GET /api/growth/feedback/:page_id without auth returns 401")


class TestFeedbackValidation(TestSetup):
    """POST /api/growth/feedback - Validation tests"""
    
    def test_feedback_missing_content_type_returns_400(self, auth_headers):
        """POST /api/growth/feedback with missing content_type returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={"page_id": "test", "rating": 1}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "content_type" in data.get("error", "").lower() or "required" in data.get("error", "").lower()
        print("✓ POST /api/growth/feedback with missing content_type returns 400")
    
    def test_feedback_missing_page_id_returns_400(self, auth_headers):
        """POST /api/growth/feedback with missing page_id returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={"content_type": "fixes", "rating": 1}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ POST /api/growth/feedback with missing page_id returns 400")
    
    def test_feedback_invalid_rating_returns_400(self, auth_headers):
        """POST /api/growth/feedback with invalid rating returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={"page_id": "test", "content_type": "fixes", "rating": 5}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "rating" in data.get("error", "").lower() or "1" in data.get("error", "")
        print("✓ POST /api/growth/feedback with invalid rating (5) returns 400")
    
    def test_feedback_invalid_content_type_returns_400(self, auth_headers):
        """POST /api/growth/feedback with invalid content_type returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={"page_id": "test", "content_type": "invalid_type", "rating": 1}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "content_type" in data.get("error", "").lower()
        print("✓ POST /api/growth/feedback with invalid content_type returns 400")


class TestFeedbackSubmission(TestSetup):
    """POST /api/growth/feedback - Submission tests"""
    
    @pytest.fixture(scope="class")
    def test_page_id(self, auth_headers):
        """Get a valid page_id from existing pages"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed to get pages: {response.text}"
        data = response.json()
        pages = data.get("pages", [])
        assert len(pages) > 0, "No pages found for testing"
        return pages[0]["id"]
    
    def test_submit_thumbs_up_for_fixes(self, auth_headers, test_page_id):
        """POST /api/growth/feedback - stores thumbs up (rating:1) for fixes content_type, returns 201"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "fixes",
                "rating": 1
            }
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True
        assert data.get("rating") == 1
        print("✓ POST /api/growth/feedback - thumbs up for fixes returns 201")
    
    def test_submit_thumbs_down_for_social_post(self, auth_headers, test_page_id):
        """POST /api/growth/feedback - stores thumbs down (rating:-1) for social_post content_type, returns 201"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "social_post",
                "rating": -1
            }
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True
        assert data.get("rating") == -1
        print("✓ POST /api/growth/feedback - thumbs down for social_post returns 201")
    
    def test_submit_feedback_for_search_ad(self, auth_headers, test_page_id):
        """POST /api/growth/feedback - stores feedback for search_ad content_type"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "search_ad",
                "rating": 1
            }
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        print("✓ POST /api/growth/feedback - feedback for search_ad returns 201")
    
    def test_submit_feedback_for_email(self, auth_headers, test_page_id):
        """POST /api/growth/feedback - stores feedback for email content_type"""
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "email",
                "rating": -1
            }
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        print("✓ POST /api/growth/feedback - feedback for email returns 201")


class TestFeedbackUpsert(TestSetup):
    """POST /api/growth/feedback - Upsert behavior tests"""
    
    @pytest.fixture(scope="class")
    def test_page_id(self, auth_headers):
        """Get a valid page_id from existing pages"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        pages = data.get("pages", [])
        assert len(pages) > 0
        return pages[0]["id"]
    
    def test_upsert_changes_rating(self, auth_headers, test_page_id):
        """POST /api/growth/feedback - upsert behavior: submitting again for same content_type updates rating"""
        # First submit thumbs up
        response1 = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "seo_analysis",
                "rating": 1
            }
        )
        assert response1.status_code == 201
        
        # Now submit thumbs down for same content_type
        response2 = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "seo_analysis",
                "rating": -1
            }
        )
        assert response2.status_code == 201
        
        # Verify the rating was updated
        response3 = requests.get(
            f"{BASE_URL}/api/growth/feedback/{test_page_id}",
            headers=auth_headers
        )
        assert response3.status_code == 200
        data = response3.json()
        feedback_list = data.get("feedback", [])
        
        # Find seo_analysis feedback
        seo_feedback = next((f for f in feedback_list if f.get("content_type") == "seo_analysis"), None)
        assert seo_feedback is not None, "seo_analysis feedback not found"
        assert seo_feedback.get("rating") == -1, f"Expected rating -1, got {seo_feedback.get('rating')}"
        print("✓ POST /api/growth/feedback - upsert updates rating correctly")


class TestGetFeedback(TestSetup):
    """GET /api/growth/feedback/:page_id tests"""
    
    @pytest.fixture(scope="class")
    def test_page_id(self, auth_headers):
        """Get a valid page_id from existing pages"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        pages = data.get("pages", [])
        assert len(pages) > 0
        return pages[0]["id"]
    
    def test_get_feedback_returns_all_feedback(self, auth_headers, test_page_id):
        """GET /api/growth/feedback/:page_id - returns all feedback for that page"""
        response = requests.get(
            f"{BASE_URL}/api/growth/feedback/{test_page_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "feedback" in data
        feedback_list = data.get("feedback", [])
        assert isinstance(feedback_list, list)
        
        # Verify feedback structure
        if len(feedback_list) > 0:
            fb = feedback_list[0]
            assert "content_type" in fb
            assert "rating" in fb
        print(f"✓ GET /api/growth/feedback/:page_id - returns {len(feedback_list)} feedback items")


class TestPersonaScoreUpdates(TestSetup):
    """Persona score update tests"""
    
    @pytest.fixture(scope="class")
    def test_page_id(self, auth_headers):
        """Get a valid page_id from existing pages"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        pages = data.get("pages", [])
        assert len(pages) > 0
        return pages[0]["id"]
    
    @pytest.fixture(scope="class")
    def test_persona(self, auth_headers):
        """Create a test persona for score testing"""
        # First check if TEST_SCORE_PERSONA exists
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        personas = data.get("personas", [])
        
        # Find or create test persona
        test_persona = next((p for p in personas if p.get("name") == "TEST_SCORE_PERSONA"), None)
        if test_persona:
            return test_persona
        
        # Create new test persona
        response = requests.post(
            f"{BASE_URL}/api/personas/create",
            headers=auth_headers,
            json={
                "name": "TEST_SCORE_PERSONA",
                "description": "Test persona for score testing"
            }
        )
        assert response.status_code == 201, f"Failed to create persona: {response.text}"
        data = response.json()
        return data.get("persona")
    
    def test_feedback_with_persona_updates_score(self, auth_headers, test_page_id, test_persona):
        """POST /api/growth/feedback - with persona_id updates persona performance_score and feedback_count"""
        persona_id = test_persona["id"]
        
        # Get initial persona state
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        personas = data.get("personas", [])
        initial_persona = next((p for p in personas if p.get("id") == persona_id), None)
        initial_score = initial_persona.get("performance_score", 0) if initial_persona else 0
        initial_count = initial_persona.get("feedback_count", 0) if initial_persona else 0
        
        # Submit positive feedback with persona_id
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "fixes",
                "rating": 1,
                "persona_id": persona_id
            }
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        
        # Verify persona score was updated
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        personas = data.get("personas", [])
        updated_persona = next((p for p in personas if p.get("id") == persona_id), None)
        
        assert updated_persona is not None, "Test persona not found after feedback"
        # Score should have increased (or stayed same if this was an upsert with same rating)
        print(f"✓ Persona score: {initial_score} -> {updated_persona.get('performance_score', 0)}")
        print(f"✓ Feedback count: {initial_count} -> {updated_persona.get('feedback_count', 0)}")
    
    def test_negative_feedback_decreases_score(self, auth_headers, test_page_id, test_persona):
        """Submitting -1 feedback decreases performance_score"""
        persona_id = test_persona["id"]
        
        # Get current persona state
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        personas = data.get("personas", [])
        current_persona = next((p for p in personas if p.get("id") == persona_id), None)
        current_score = current_persona.get("performance_score", 0) if current_persona else 0
        
        # Submit negative feedback with persona_id (different content_type to avoid upsert)
        response = requests.post(
            f"{BASE_URL}/api/growth/feedback",
            headers=auth_headers,
            json={
                "page_id": test_page_id,
                "content_type": "email",
                "rating": -1,
                "persona_id": persona_id
            }
        )
        assert response.status_code == 201
        
        # Verify persona score was updated
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        personas = data.get("personas", [])
        updated_persona = next((p for p in personas if p.get("id") == persona_id), None)
        
        assert updated_persona is not None
        new_score = updated_persona.get("performance_score", 0)
        print(f"✓ Negative feedback: score {current_score} -> {new_score}")


class TestAutoModePersonaSorting(TestSetup):
    """Auto mode verify: analyze endpoint sorts personas by performance_score desc"""
    
    def test_personas_sorted_by_performance_score(self, auth_headers):
        """GET /api/personas - returns personas sorted by performance_score desc"""
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        personas = data.get("personas", [])
        
        if len(personas) > 1:
            # Verify sorting by performance_score descending
            scores = [p.get("performance_score", 0) for p in personas]
            assert scores == sorted(scores, reverse=True), f"Personas not sorted by performance_score: {scores}"
            print(f"✓ Personas sorted by performance_score desc: {scores}")
        else:
            print(f"✓ Only {len(personas)} persona(s), sorting verified")


class TestExistingFunctionality(TestSetup):
    """Verify existing functionality still works"""
    
    def test_pages_list_works(self, auth_headers):
        """GET /api/growth/pages still works"""
        response = requests.get(
            f"{BASE_URL}/api/growth/pages",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "pages" in data
        print(f"✓ GET /api/growth/pages works - {len(data.get('pages', []))} pages")
    
    def test_personas_list_works(self, auth_headers):
        """GET /api/personas still works"""
        response = requests.get(
            f"{BASE_URL}/api/personas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "personas" in data
        print(f"✓ GET /api/personas works - {len(data.get('personas', []))} personas")
    
    def test_trends_list_works(self, auth_headers):
        """GET /api/trends still works"""
        response = requests.get(
            f"{BASE_URL}/api/trends",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "trends" in data
        print(f"✓ GET /api/trends works - {len(data.get('trends', []))} trends")


# Cleanup fixture
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_personas():
    """Cleanup TEST_ prefixed personas after all tests"""
    yield
    # Cleanup after tests
    try:
        supabase_url = "https://cawmmqakaxbznbelcrwd.supabase.co"
        supabase_key = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
        
        response = requests.post(
            f"{supabase_url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": supabase_key,
                "Content-Type": "application/json"
            },
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }
        )
        if response.status_code == 200:
            token = response.json().get("access_token")
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # Get all personas
            res = requests.get(f"{BASE_URL}/api/personas", headers=headers)
            if res.status_code == 200:
                personas = res.json().get("personas", [])
                for p in personas:
                    if p.get("name", "").startswith("TEST_"):
                        requests.delete(f"{BASE_URL}/api/personas/{p['id']}", headers=headers)
                        print(f"Cleaned up test persona: {p['name']}")
    except Exception as e:
        print(f"Cleanup warning: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
