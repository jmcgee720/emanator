// New prompt templates
const frontendOnlyPrompts = [
    {
        id: 'backend-required',
        message: 'This feature requires a backend service. The current implementation is frontend-only and may have limitations.',
    },
    {
        id: 'extendable-frontend',
        message: 'This is a static frontend version. Consider extending it with backend integration for full functionality.',
    },
    {
        id: 'chat-only',
        message: 'This is a chat-only interaction. No further action is required.',
    },
    // Additional existing prompts
];

export default frontendOnlyPrompts;
