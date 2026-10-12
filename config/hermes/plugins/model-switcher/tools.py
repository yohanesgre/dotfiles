"""Model switcher plugin — /quick, /balanced, /deep slash commands.

Uses the pre_gateway_dispatch hook to intercept messages starting with
a preset command, set session-level model + reasoning overrides directly
on the gateway runner, then rewrite the event text to the user's actual
message — so the switch takes effect immediately, no /reset needed.

DeepSeek V4.1 Flash exposes exactly three thinking-effort levels
(``low`` / ``high`` / ``max``, default ``high``); each preset is one level.
"""

PRESETS = {
    "quick": {
        "model": "deepseek-flash",
        "reasoning_effort": "low",
        "description": "Fast — V4.1 Flash, low thinking",
        "emoji": "⚡",
    },
    "balanced": {
        "model": "deepseek-flash",
        "reasoning_effort": "high",
        "description": "Balanced — V4.1 Flash, high thinking (default)",
        "emoji": "🔥",
    },
    "deep": {
        "model": "deepseek-flash",
        "reasoning_effort": "max",
        "description": "Deep — V4.1 Flash, max thinking",
        "emoji": "🔬",
    },
}


def register(ctx):
    """Register slash commands and the gateway dispatch hook."""

    for name, cfg in PRESETS.items():
        handler = _make_plugin_handler(name, cfg)
        ctx.register_command(
            name=name,
            handler=handler,
            description=f"{cfg['emoji']} {cfg['description']}",
        )

    ctx.register_hook("pre_gateway_dispatch", _on_pre_dispatch)


def _on_pre_dispatch(*, event, gateway, session_store, **kwargs):
    """pre_gateway_dispatch hook: intercept preset commands, set session overrides."""
    import logging
    logger = logging.getLogger(__name__)

    text = (event.text or "").strip()
    if not text:
        return None

    first_word = text.split(maxsplit=1)[0].lower().lstrip("/")
    if first_word not in PRESETS:
        return None

    cfg = PRESETS[first_word]

    # Extract user's message after the command
    _, _, rest = text.partition(" ")
    user_message = rest.strip()

    # Derive session key
    try:
        session_key = gateway._session_key_for_source(event.source)
    except Exception:
        logger.warning("model-switcher: could not derive session key")
        return None

    # ── Set model override ──
    model_override = {"model": cfg["model"]}
    try:
        import yaml
        from hermes_cli.config import get_hermes_home
        config_path = get_hermes_home() / "config.yaml"
        if config_path.exists():
            with open(config_path) as f:
                raw_cfg = yaml.safe_load(f) or {}
            model_cfg = raw_cfg.get("model", {})
            if isinstance(model_cfg, dict):
                model_override["provider"] = model_cfg.get("provider", "deepseek")
                model_override["base_url"] = model_cfg.get("base_url", "")
            else:
                model_override["provider"] = "deepseek"
        else:
            model_override["provider"] = "deepseek"
    except Exception:
        model_override["provider"] = "deepseek"

    gateway._session_model_overrides[session_key] = model_override

    # ── Set reasoning override ──
    reasoning_config = {"enabled": True, "effort": cfg["reasoning_effort"]}
    gateway._set_session_reasoning_override(session_key, reasoning_config)

    # Evict cached agent so the next turn picks up new settings
    gateway._evict_cached_agent(session_key)

    logger.info(
        "model-switcher: session=%s → %s (model=%s reasoning=%s)",
        session_key, first_word, cfg["model"], cfg["reasoning_effort"],
    )

    # If user included a follow-up message, rewrite event.text so the
    # agent processes it with the new settings.
    # If just the bare command, return None — let the plugin slash command
    # handler fire and return a confirmation message.
    if user_message:
        return {"action": "rewrite", "text": user_message}

    return None


def _make_plugin_handler(name, cfg):
    """Return a handler for the plugin slash command."""
    def _handler(raw_args: str) -> str:
        return (
            f"{cfg['emoji']} **{name.title()}** mode activated!\n"
            f"   Model: `{cfg['model']}`\n"
            f"   Reasoning: `{cfg['reasoning_effort']}`\n"
            f"   _Takes effect immediately for this session._"
        )
    _handler.__name__ = f"_handle_{name}"
    return _handler
