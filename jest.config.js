const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: [],
  modulePathIgnorePatterns: [
    '<rootDir>/.next/'
  ],
  testEnvironment: 'node',
  // Transform ES modules
  transformIgnorePatterns: [
    'node_modules/(?!(@supabase|@anthropic-ai|openai)/)'
  ],
  // Add more setup options if needed
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)