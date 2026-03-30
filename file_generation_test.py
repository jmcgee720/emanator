#!/usr/bin/env python3
"""
Additional verification test to check file generation with different prompts
"""

import requests
import json
import time

API_URL = "https://ai-builder-hub-47.preview.emergentagent.com"
SUPABASE_URL = "https://cawmmqakaxbznbelcrwd.supabase.co"
SUPABASE_KEY = "sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22"
CHAT_ID = "36c0d150-2960-4b70-9267-9b6a521893a8"
TEST_EMAIL = "REDACTED_LEAKED_USER"
TEST_PASSWORD = "REDACTED_LEAKED_PASSWORD"

def get_token():
    """Get auth token"""
    auth_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    data = {"email": TEST_EMAIL, "password": TEST_PASSWORD}
    
    response = requests.post(auth_url, headers=headers, json=data)
    if response.status_code == 200:
        return response.json().get('access_token', '')
    return None

def test_file_generation_with_clear_build_intent():
    """Test file generation with a very clear build intent"""
    token = get_token()
    if not token:
        print("❌ No token")
        return False
    
    url = f"{API_URL}/api/chats/{CHAT_ID}/messages/stream"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = {
        "content": "Create a new React component called FeatureCard.jsx with props for title, description and icon",
        "metadata": {"provider": "openai", "model": "gpt-4o", "scope": "project"}
    }
    
    print("Testing file generation with build intent...")
    
    response = requests.post(url, headers=headers, json=data, stream=True, timeout=60)
    
    if response.status_code != 200:
        print(f"❌ Status: {response.status_code}")
        return False
    
    file_events = []
    saving_files_found = False
    current_event_type = None
    
    for line in response.iter_lines(decode_unicode=True):
        if not line or line.strip() == '':
            continue
            
        if line.startswith('event:'):
            current_event_type = line[6:].strip()
        elif line.startswith('data:'):
            try:
                data_content = line[5:].strip()
                if not data_content:
                    continue
                event_data = json.loads(data_content)
                
                if current_event_type == 'status':
                    stage = event_data.get('stage', '')
                    if stage == 'saving_files':
                        saving_files_found = True
                        print(f"✅ Found saving_files status: {event_data}")
                elif current_event_type == 'file':
                    file_events.append(event_data)
                    print(f"✅ File event: {event_data}")
                elif current_event_type == 'done':
                    print(f"Done event: {event_data}")
                    break
                    
            except json.JSONDecodeError:
                pass
    
    print(f"Saving files status found: {saving_files_found}")
    print(f"File events found: {len(file_events)}")
    
    # Check if FeatureCard.jsx was created
    feature_card_created = any('FeatureCard.jsx' in event.get('path', '') for event in file_events)
    print(f"FeatureCard.jsx creation detected: {feature_card_created}")
    
    return True

if __name__ == "__main__":
    test_file_generation_with_clear_build_intent()