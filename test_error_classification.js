// Node.js test script to directly test the error classification function
// This tests the classifyProviderError function with various error scenarios

import { classifyProviderError, ProviderError } from './lib/ai/errors.js'

console.log('🧪 Testing Error Classification Function Directly')
console.log('=' * 50)

// Test cases for error classification
const testCases = [
  {
    name: 'Billing Error - Status 402',
    error: { status: 402, message: 'Insufficient quota' },
    provider: 'openai',
    model: 'gpt-4o',
    expectedType: 'billing'
  },
  {
    name: 'Billing Error - Credit Message',
    error: { message: 'You exceeded your current quota, please check your plan and billing details.' },
    provider: 'openai', 
    model: 'gpt-4o',
    expectedType: 'billing'
  },
  {
    name: 'Auth Error - Status 401',
    error: { status: 401, message: 'Invalid API key provided' },
    provider: 'anthropic',
    model: 'claude-sonnet-4-6', 
    expectedType: 'auth'
  },
  {
    name: 'Auth Error - Key Message',
    error: { message: 'Incorrect API key provided' },
    provider: 'openai',
    model: 'gpt-4o',
    expectedType: 'auth'
  },
  {
    name: 'Rate Limit - Status 429',
    error: { status: 429, message: 'Rate limit reached' },
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    expectedType: 'rate_limit'
  },
  {
    name: 'Rate Limit - Message Text',
    error: { message: 'Too many requests, please slow down' },
    provider: 'openai',
    model: 'gpt-4o',
    expectedType: 'rate_limit'
  },
  {
    name: 'Context Length Error',
    error: { message: 'Maximum context length exceeded for model' },
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    expectedType: 'context_length'
  },
  {
    name: 'Unavailable - Status 503',
    error: { status: 503, message: 'Service temporarily unavailable' },
    provider: 'openai',
    model: 'gpt-4o',
    expectedType: 'unavailable'
  },
  {
    name: 'Unavailable - Overloaded',
    error: { message: 'The model is currently overloaded with requests' },
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    expectedType: 'unavailable'
  },
  {
    name: 'Unknown Error',
    error: { status: 400, message: 'Some random error' },
    provider: 'openai',
    model: 'gpt-4o',
    expectedType: 'unknown'
  }
]

let passed = 0
let total = testCases.length

console.log(`\nRunning ${total} error classification tests...\n`)

for (const testCase of testCases) {
  try {
    console.log(`Testing: ${testCase.name}`)
    console.log(`  Input: ${JSON.stringify(testCase.error)}`)
    console.log(`  Provider: ${testCase.provider}, Model: ${testCase.model}`)
    console.log(`  Expected type: ${testCase.expectedType}`)
    
    const result = classifyProviderError(testCase.error, testCase.provider, testCase.model)
    
    console.log(`  Result type: ${result.error_type}`)
    console.log(`  User message: "${result.user_message}"`)
    console.log(`  Provider: ${result.provider}`)
    console.log(`  Model: ${result.model}`)
    console.log(`  Status code: ${result.status_code}`)
    
    if (result.error_type === testCase.expectedType) {
      console.log(`  ✅ PASS - Correct error type`)
      passed++
    } else {
      console.log(`  ❌ FAIL - Expected ${testCase.expectedType}, got ${result.error_type}`)
    }
    
    // Validate that it's a ProviderError instance
    if (result instanceof ProviderError) {
      console.log(`  ✅ Correct ProviderError instance`)
    } else {
      console.log(`  ❌ Not a ProviderError instance`)
    }
    
    // Validate user message is user-friendly (not raw error)
    if (result.user_message && !result.user_message.includes('status') && !result.user_message.includes('{')) {
      console.log(`  ✅ User-friendly message`)
    } else {
      console.log(`  ⚠️  Message may not be user-friendly`)
    }
    
    console.log('')
    
  } catch (error) {
    console.log(`  ❌ ERROR: ${error.message}`)
    console.log('')
  }
}

console.log('=' * 50)
console.log(`📊 Results: ${passed}/${total} tests passed (${(passed/total)*100}%)`)

if (passed === total) {
  console.log('🎉 All error classification tests passed!')
} else {
  console.log(`⚠️  ${total - passed} tests failed`)
  process.exit(1)
}