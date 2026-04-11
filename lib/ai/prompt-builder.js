// Modified prompt builder to handle frontend-only requests
function buildPrompt(request) {
    if (request.isChatOnly) {
        return `This is a chat-only interaction. Responding conversationally.`;
    }
    if (request.frontendOnly) {
        return `This is a mockup of the feature. Note: ${request.message}`;
    }
    // Existing logic for prompt building
    return generatePrompt(request);
}