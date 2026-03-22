/**
 * Test Next.js module alias resolution for @/lib/... paths
 */

async function testModuleAliases() {
  console.log('🧪 Testing Next.js module alias resolution...\n')
  
  try {
    console.log('🔍 Testing @/lib/self_builder/request_router import')
    
    // This should work with Next.js module aliases
    const { request_router, detectActiveObjective } = await import('@/lib/self_builder/request_router')
    
    console.log('✅ PASSED: Module imported successfully with @/lib alias')
    
    // Test basic functionality
    console.log('🔍 Testing basic function availability')
    
    if (typeof request_router === 'function') {
      console.log('✅ PASSED: request_router is a function')
    } else {
      throw new Error('request_router is not a function')
    }
    
    if (typeof detectActiveObjective === 'function') {
      console.log('✅ PASSED: detectActiveObjective is a function')
    } else {
      throw new Error('detectActiveObjective is not a function')
    }
    
    // Test with null values (should not crash)
    const result = await detectActiveObjective(null)
    if (result === null) {
      console.log('✅ PASSED: detectActiveObjective(null) returns null')
    } else {
      throw new Error('detectActiveObjective(null) should return null')
    }
    
    console.log('\n🎉 Module alias resolution tests passed!')
    return true
    
  } catch (error) {
    console.log(`❌ Module alias test failed: ${error.message}`)
    return false
  }
}

testModuleAliases().then(success => {
  process.exit(success ? 0 : 1)
}).catch(error => {
  console.error('Test error:', error)
  process.exit(1)
})