from google.genai import Client

from config.settings import get_settings

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.gemini_api_key:
            raise ValueError("Set GEMINI_API_KEY for Gemini API access")
        _client = Client(api_key=settings.gemini_api_key)
    return _client


async def call_llm(system_prompt: str, user_prompt: str) -> str:
    settings = get_settings()
    client = get_client()
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=user_prompt,
        config={
            "system_instruction": system_prompt,
            "temperature": 0.2,
            "response_mime_type": "text/plain",
        },
    )
    return (response.text or "").strip()
