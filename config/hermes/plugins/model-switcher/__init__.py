"""Model switcher plugin — /quick, /balanced, /deep slash commands.

Uses the pre_gateway_dispatch hook to intercept messages starting with
a preset command, set session-level model + reasoning overrides directly
on the gateway runner, then rewrite the event text to the user's actual
message — so the switch takes effect immediately, no /reset needed.

Presets map onto the DeepSeek V4.1 Flash thinking-effort ladder
(low / high / max); the model is always ``deepseek-flash``.
"""
from .tools import _make_plugin_handler, _on_pre_dispatch, PRESETS


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
