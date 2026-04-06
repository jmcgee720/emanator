"""
Test image-prefetch module functions for the two-tier image system.
Tests: detectImageCategories, getStockPhotos, buildImagePromptContext
"""
import pytest
import subprocess
import json
import os

# Since this is a Next.js app with JS modules, we'll test via Node.js execution
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://syntax-error-patch.preview.emergentagent.com')


class TestImagePrefetchModule:
    """Test the image-prefetch.js module functions"""
    
    def test_detect_image_categories_plants(self):
        """Test keyword detection for plants category"""
        result = subprocess.run([
            'node', '-e', '''
            import { detectImageCategories } from '/app/lib/ai/image-prefetch.js';
            const result = detectImageCategories("Build a plant care app with houseplant tracking");
            console.log(JSON.stringify(result));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        categories = json.loads(result.stdout.strip())
        assert 'plants' in categories, f"Expected 'plants' in categories, got: {categories}"
    
    def test_detect_image_categories_food(self):
        """Test keyword detection for food category"""
        result = subprocess.run([
            'node', '-e', '''
            import { detectImageCategories } from '/app/lib/ai/image-prefetch.js';
            const result = detectImageCategories("Create a restaurant menu with recipes");
            console.log(JSON.stringify(result));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        categories = json.loads(result.stdout.strip())
        assert 'food' in categories, f"Expected 'food' in categories, got: {categories}"
    
    def test_detect_image_categories_multiple(self):
        """Test keyword detection for multiple categories"""
        result = subprocess.run([
            'node', '-e', '''
            import { detectImageCategories } from '/app/lib/ai/image-prefetch.js';
            const result = detectImageCategories("Build a travel website with nature photography and people testimonials");
            console.log(JSON.stringify(result));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        categories = json.loads(result.stdout.strip())
        assert 'travel' in categories or 'nature' in categories or 'people' in categories, f"Expected travel/nature/people in categories, got: {categories}"
    
    def test_detect_image_categories_empty(self):
        """Test keyword detection returns empty for non-visual prompts"""
        result = subprocess.run([
            'node', '-e', '''
            import { detectImageCategories } from '/app/lib/ai/image-prefetch.js';
            const result = detectImageCategories("Fix the bug in the login function");
            console.log(JSON.stringify(result));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        categories = json.loads(result.stdout.strip())
        assert len(categories) == 0, f"Expected empty categories for non-visual prompt, got: {categories}"
    
    def test_get_stock_photos_returns_urls(self):
        """Test getStockPhotos returns valid Unsplash URLs"""
        result = subprocess.run([
            'node', '-e', '''
            import { getStockPhotos } from '/app/lib/ai/image-prefetch.js';
            const result = getStockPhotos(['plants', 'nature'], 2);
            console.log(JSON.stringify(result));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        photos = json.loads(result.stdout.strip())
        assert len(photos) > 0, "Expected at least one photo"
        for photo in photos:
            assert 'url' in photo, f"Photo missing 'url': {photo}"
            assert 'alt' in photo, f"Photo missing 'alt': {photo}"
            assert 'category' in photo, f"Photo missing 'category': {photo}"
            assert 'unsplash.com' in photo['url'], f"Expected Unsplash URL, got: {photo['url']}"
    
    def test_build_image_prompt_context_stock(self):
        """Test buildImagePromptContext generates correct prompt for stock images"""
        result = subprocess.run([
            'node', '-e', '''
            import { buildImagePromptContext } from '/app/lib/ai/image-prefetch.js';
            const images = [
                { url: 'https://images.unsplash.com/photo-123', alt: 'Test image', category: 'plants' }
            ];
            const result = buildImagePromptContext(images, false);
            console.log(JSON.stringify({ context: result }));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        data = json.loads(result.stdout.strip())
        context = data['context']
        assert 'Curated stock' in context, f"Expected 'Curated stock' in context, got: {context[:200]}"
        assert 'unsplash.com' in context, f"Expected Unsplash URL in context"
        assert 'MUST use these real image URLs' in context, f"Expected usage instruction in context"
    
    def test_build_image_prompt_context_custom(self):
        """Test buildImagePromptContext generates correct prompt for custom images"""
        result = subprocess.run([
            'node', '-e', '''
            import { buildImagePromptContext } from '/app/lib/ai/image-prefetch.js';
            const images = [
                { url: 'data:image/png;base64,abc123', alt: 'AI generated', category: 'custom', isGenerated: true }
            ];
            const result = buildImagePromptContext(images, true);
            console.log(JSON.stringify({ context: result }));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        data = json.loads(result.stdout.strip())
        context = data['context']
        assert 'Custom AI-generated' in context, f"Expected 'Custom AI-generated' in context, got: {context[:200]}"
    
    def test_has_visual_intent(self):
        """Test hasVisualIntent detects visual signals"""
        result = subprocess.run([
            'node', '-e', '''
            import { hasVisualIntent } from '/app/lib/ai/image-prefetch.js';
            const tests = [
                { msg: "Build a stunning landing page with beautiful images", expected: true },
                { msg: "Fix the database connection", expected: false },
                { msg: "Create a hero image banner", expected: true },
                { msg: "Add a photo gallery", expected: true }
            ];
            const results = tests.map(t => ({ ...t, actual: hasVisualIntent(t.msg) }));
            console.log(JSON.stringify(results));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        results = json.loads(result.stdout.strip())
        for r in results:
            assert r['actual'] == r['expected'], f"hasVisualIntent('{r['msg']}') = {r['actual']}, expected {r['expected']}"


class TestCreditsServiceVisualMode:
    """Test estimateRequestCost with visualMode parameter"""
    
    def test_estimate_cost_stock_mode(self):
        """Test estimateRequestCost returns base cost for stock mode"""
        result = subprocess.run([
            'node', '-e', '''
            import { estimateRequestCost } from '/app/lib/credits/service.js';
            const cost = estimateRequestCost('gpt-4o', 'stock');
            console.log(JSON.stringify({ cost }));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        data = json.loads(result.stdout.strip())
        # gpt-4o has credits: 1.0, stock mode should return base cost
        assert data['cost'] == 1.0, f"Expected cost 1.0 for stock mode, got: {data['cost']}"
    
    def test_estimate_cost_custom_mode_3x(self):
        """Test estimateRequestCost returns 3x cost for custom mode"""
        result = subprocess.run([
            'node', '-e', '''
            import { estimateRequestCost } from '/app/lib/credits/service.js';
            const cost = estimateRequestCost('gpt-4o', 'custom');
            console.log(JSON.stringify({ cost }));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        data = json.loads(result.stdout.strip())
        # gpt-4o has credits: 1.0, custom mode should return 3x = 3.0
        assert data['cost'] == 3.0, f"Expected cost 3.0 for custom mode (3x), got: {data['cost']}"
    
    def test_estimate_cost_no_visual_mode(self):
        """Test estimateRequestCost returns base cost when visualMode is undefined"""
        result = subprocess.run([
            'node', '-e', '''
            import { estimateRequestCost } from '/app/lib/credits/service.js';
            const cost = estimateRequestCost('gpt-4o-mini');
            console.log(JSON.stringify({ cost }));
            '''
        ], capture_output=True, text=True, cwd='/app')
        
        assert result.returncode == 0, f"Node execution failed: {result.stderr}"
        data = json.loads(result.stdout.strip())
        # gpt-4o-mini has credits: 0.25
        assert data['cost'] == 0.25, f"Expected cost 0.25 for gpt-4o-mini, got: {data['cost']}"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
