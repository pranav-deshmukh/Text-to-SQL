from dataclasses import dataclass

from config.settings import get_settings


@dataclass(frozen=True)
class AuditConfig:
    app_env: str
    enabled: bool
    ui_enabled: bool
    include_stack: bool
    max_text_length: int


def get_audit_config() -> AuditConfig:
    settings = get_settings()
    app_env = "prod" if settings.app_env.lower() in {"prod", "production"} else "dev"
    return AuditConfig(
        app_env=app_env,
        enabled=bool(settings.audit_enabled),
        ui_enabled=bool(settings.audit_ui_enabled) and app_env == "dev",
        include_stack=bool(settings.audit_include_stack) and app_env == "dev",
        max_text_length=max(200, int(settings.audit_max_text_length)),
    )