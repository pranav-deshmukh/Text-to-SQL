import asyncio

from google.genai import Client

from config.settings import get_settings

_client: Client | None = None
MAX_GENERATION_ATTEMPTS = 2


def get_client() -> Client:
    global _client
    if _client is None:
        settings = get_settings()
        if settings.google_cloud_project:
            _client = Client(
                vertexai=True,
                project=settings.google_cloud_project,
                location=settings.google_cloud_location,
            )
        else:
            if not settings.gemini_api_key:
                raise ValueError(
                    "Set GOOGLE_CLOUD_PROJECT for Vertex AI or GEMINI_API_KEY for Gemini API access"
                )
            _client = Client(api_key=settings.gemini_api_key)
    return _client


async def call_llm(system_prompt: str, user_prompt: str, attempt: int = 1) -> str:
    settings = get_settings()
    client = get_client()
    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=user_prompt,
            config={
                "system_instruction": system_prompt,
                "temperature": 0.2,
                "response_mime_type": "text/plain",
            },
        )
        text = (response.text or "").strip()
        normalized = text
        while True:
            start = normalized.find("<think>")
            end = normalized.find("</think>")
            if start == -1 or end == -1 or end < start:
                break
            normalized = normalized[:start] + normalized[end + len("</think>"):]
        normalized = normalized.strip()

        if (not normalized or normalized.upper() == "ERROR") and attempt < MAX_GENERATION_ATTEMPTS:
            return await call_llm(system_prompt, user_prompt, attempt + 1)

        return normalized
    except Exception as exc:
        status = getattr(exc, "status", None) or getattr(exc, "code", None)
        if status == 429:
            await asyncio.sleep(15)
            return await call_llm(system_prompt, user_prompt, attempt)
        raise
