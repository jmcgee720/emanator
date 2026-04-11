// request_router.js

function routeRequest(request) {
    if (isConversationalIntent(request.message)) {
        return handleConversationalIntent(request);
    }
    // existing logic for actionable intents
    return handleActionableIntent(request);
}

function isConversationalIntent(message) {
    const conversationalKeywords = [
        "thanks", "looks good", "what else can you do?", "hello", "hi", "how are you", "bye", "goodbye", "see you",
        "ok", "alright", "cool", "nice", "great", "no problem", "got it", "understood", "yep", "yeah"
    ];
    return conversationalKeywords.some(keyword => message.toLowerCase().includes(keyword));
}

function handleConversationalIntent(request) {
    // Handle the conversational message appropriately
    console.log("Detected conversational intent: ", request.message);
    return { response: "Conversational message received. How can I assist you further?" };
}

function handleActionableIntent(request) {
    // Existing logic for handling actionable requests
    return { response: "Actionable intent handled." };
}

export { routeRequest };