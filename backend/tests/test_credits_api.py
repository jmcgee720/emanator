"""
Credits API Tests - Platform-managed billing + credits system
Tests: GET /api/credits, POST /api/credits/use, POST /api/credits/add

This test uses Supabase authentication to get a valid session token.
"""
import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com').rstrip('/')

# Supabase config
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"

# Test credentials
TEST_EMAIL = "testprov@test.com"
TEST_PASSWORD = "password123"


def get_supabase_token():
    """Get auth token from Supabase"""
    auth_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    response = requests.post(
        auth_url,
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
        },
        json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD,
        }
    )
    if response.status_code == 200:
        data = response.json()
        return data.get("access_token")
    print(f"Supabase auth failed: {response.status_code} - {response.text}")
    return None


class TestCreditsAPI:
    """Credits endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup auth token for tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.token = get_supabase_token()
        
        if self.token:
            self.session.headers.update({"Authorization": f"Bearer {self.token}"})
            print(f"Auth token obtained successfully")
        else:
            print("Failed to get auth token")
        
        yield
        self.session.close()
    
    def test_get_credits_unauthenticated(self):
        """GET /api/credits without auth should return 401"""
        response = requests.get(f"{BASE_URL}/api/credits")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: GET /api/credits returns 401 when unauthenticated")
    
    def test_get_credits_authenticated(self):
        """GET /api/credits returns balance, costs, packages, and modelCosts when authenticated"""
        if not self.token:
            pytest.skip("Authentication failed - skipping authenticated tests")
        
        response = self.session.get(f"{BASE_URL}/api/credits")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify balance field exists
        assert "balance" in data, f"Response missing 'balance' field: {data}"
        assert isinstance(data["balance"], (int, float)), f"Balance should be numeric: {data['balance']}"
        
        # Verify costs field exists (action costs)
        assert "costs" in data, f"Response missing 'costs' field: {data}"
        assert isinstance(data["costs"], dict), f"Costs should be a dict: {data['costs']}"
        
        # Verify packages field exists
        assert "packages" in data, f"Response missing 'packages' field: {data}"
        assert isinstance(data["packages"], list), f"Packages should be a list: {data['packages']}"
        
        # Verify modelCosts field exists (NEW - model-specific costs)
        assert "modelCosts" in data, f"Response missing 'modelCosts' field: {data}"
        assert isinstance(data["modelCosts"], dict), f"modelCosts should be a dict: {data['modelCosts']}"
        
        # Verify modelCosts has expected models with correct structure
        expected_models = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6']
        for model in expected_models:
            if model in data["modelCosts"]:
                model_cost = data["modelCosts"][model]
                assert "credits" in model_cost, f"Model {model} missing 'credits' field"
                assert "tier" in model_cost, f"Model {model} missing 'tier' field"
                assert "label" in model_cost, f"Model {model} missing 'label' field"
        
        print(f"PASS: GET /api/credits returns complete data - balance: {data['balance']}, modelCosts: {list(data['modelCosts'].keys())}")
    
    def test_use_credits_deducts_balance(self):
        """POST /api/credits/use deducts credits and returns new balance"""
        if not self.token:
            pytest.skip("Authentication failed - skipping authenticated tests")
        
        # Get initial balance
        initial_response = self.session.get(f"{BASE_URL}/api/credits")
        assert initial_response.status_code == 200
        initial_balance = initial_response.json()["balance"]
        
        # Use credits for a chat_message action
        use_response = self.session.post(
            f"{BASE_URL}/api/credits/use",
            json={"action_type": "chat_message"}
        )
        
        # If insufficient credits, that's a valid response (402)
        if use_response.status_code == 402:
            data = use_response.json()
            assert "error" in data
            assert "Insufficient" in data["error"]
            print(f"PASS: POST /api/credits/use returns 402 when insufficient credits (balance: {data.get('balance', 'N/A')})")
            return
        
        assert use_response.status_code == 200, f"Expected 200, got {use_response.status_code}: {use_response.text}"
        
        data = use_response.json()
        assert "balance" in data, f"Response missing 'balance' field: {data}"
        assert "cost" in data, f"Response missing 'cost' field: {data}"
        
        # Verify balance decreased
        assert data["balance"] < initial_balance, f"Balance should decrease: {initial_balance} -> {data['balance']}"
        
        print(f"PASS: POST /api/credits/use deducted credits - {initial_balance} -> {data['balance']} (cost: {data['cost']})")
    
    def test_use_credits_invalid_action(self):
        """POST /api/credits/use with invalid action_type returns 400"""
        if not self.token:
            pytest.skip("Authentication failed - skipping authenticated tests")
        
        response = self.session.post(
            f"{BASE_URL}/api/credits/use",
            json={"action_type": "invalid_action_xyz"}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        data = response.json()
        assert "error" in data
        print("PASS: POST /api/credits/use returns 400 for invalid action_type")
    
    def test_add_credits_increases_balance(self):
        """POST /api/credits/add adds credits and returns new balance"""
        if not self.token:
            pytest.skip("Authentication failed - skipping authenticated tests")
        
        # Get initial balance
        initial_response = self.session.get(f"{BASE_URL}/api/credits")
        assert initial_response.status_code == 200
        initial_balance = initial_response.json()["balance"]
        
        # Add credits
        add_amount = 10.0
        add_response = self.session.post(
            f"{BASE_URL}/api/credits/add",
            json={"amount": add_amount}
        )
        
        assert add_response.status_code == 200, f"Expected 200, got {add_response.status_code}: {add_response.text}"
        
        data = add_response.json()
        assert "balance" in data, f"Response missing 'balance' field: {data}"
        
        # Verify balance increased
        expected_balance = initial_balance + add_amount
        assert abs(data["balance"] - expected_balance) < 0.01, f"Balance should be {expected_balance}, got {data['balance']}"
        
        print(f"PASS: POST /api/credits/add increased balance - {initial_balance} + {add_amount} = {data['balance']}")
    
    def test_add_credits_invalid_amount(self):
        """POST /api/credits/add with invalid amount returns 400"""
        if not self.token:
            pytest.skip("Authentication failed - skipping authenticated tests")
        
        # Test negative amount
        response = self.session.post(
            f"{BASE_URL}/api/credits/add",
            json={"amount": -10}
        )
        assert response.status_code == 400, f"Expected 400 for negative amount, got {response.status_code}"
        
        # Test zero amount
        response = self.session.post(
            f"{BASE_URL}/api/credits/add",
            json={"amount": 0}
        )
        assert response.status_code == 400, f"Expected 400 for zero amount, got {response.status_code}"
        
        print("PASS: POST /api/credits/add returns 400 for invalid amounts")


class TestModelCostsInCreditsResponse:
    """Verify modelCosts includes expected model cost tiers"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.token = get_supabase_token()
        yield
    
    def test_model_costs_structure(self):
        """Verify modelCosts has correct structure for all models"""
        if not self.token:
            pytest.skip("Authentication failed")
        
        response = requests.get(
            f"{BASE_URL}/api/credits",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        model_costs = data.get("modelCosts", {})
        
        # Verify specific model costs match expected values from service.js
        expected_costs = {
            'gpt-4o': {'credits': 1.0, 'tier': 'high'},
            'gpt-4o-mini': {'credits': 0.25, 'tier': 'standard'},
            'claude-sonnet-4-6': {'credits': 1.0, 'tier': 'high'},
            'claude-opus-4-6': {'credits': 2.5, 'tier': 'premium'},
            'claude-haiku-4-5': {'credits': 0.25, 'tier': 'standard'},
        }
        
        for model, expected in expected_costs.items():
            if model in model_costs:
                assert model_costs[model]['credits'] == expected['credits'], \
                    f"Model {model} credits mismatch: expected {expected['credits']}, got {model_costs[model]['credits']}"
                assert model_costs[model]['tier'] == expected['tier'], \
                    f"Model {model} tier mismatch: expected {expected['tier']}, got {model_costs[model]['tier']}"
        
        print(f"PASS: modelCosts contains correct cost tiers for {len(model_costs)} models")


class TestLoginFlow:
    """Verify Supabase login still works"""
    
    def test_supabase_login_success(self):
        """Login with valid credentials via Supabase should succeed"""
        token = get_supabase_token()
        assert token is not None, "Failed to get Supabase auth token"
        assert len(token) > 0, "Token should not be empty"
        print(f"PASS: Supabase login successful for {TEST_EMAIL}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
