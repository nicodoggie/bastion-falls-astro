#!/usr/bin/env python3
"""Isolated Hermes launcher exposing only validate_repair_json."""

from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

TOOL_NAME = "validate_repair_json"
TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": "Validate the complete JSON repair envelope you intend to submit. Call at most twice; the last valid argument is authoritative.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "oneOf": [
                {
                    "required": ["repairable", "repairedOutput"],
                    "properties": {"repairable": {"const": True}, "repairedOutput": {"type": "object"}},
                },
                {
                    "required": ["repairable", "reason"],
                    "properties": {"repairable": {"const": False}, "reason": {"enum": ["incomplete-original", "semantic-change-required", "identity-change-required", "unsupported-repair"]}},
                },
            ],
        },
    },
}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--validator-fd", required=True, type=int)
    parser.add_argument("--node-fd", required=True, type=int)
    parser.add_argument("--tsx-fd", required=True, type=int)
    parser.add_argument("--hermes-root-fd", required=True, type=int)
    parser.add_argument("--site-packages-fd", required=True, type=int)
    parser.add_argument("--inspect-tools", action="store_true")
    return parser


def _fd_path(fd: int) -> str:
    return f"/proc/self/fd/{fd}"


def _patch_singleton_tools(run_agent: Any, request: dict[str, Any], validator_fd: int, node_fd: int, tsx_fd: int):
    calls: list[dict[str, Any]] = []

    def definitions(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [TOOL_DEFINITION]

    def dispatch(function_name: str, function_args: dict[str, Any], *_args: Any, **_kwargs: Any) -> str:
        if function_name != TOOL_NAME:
            raise RuntimeError("unavailable tool")
        if len(calls) >= 2:
            result = {
                "valid": False,
                "submissionNumber": 2,
                "issues": [{"code": "maximum-submissions-exceeded", "path": []}],
            }
        else:
            payload = {
                "originalOutput": request["originalOutput"],
                "validation": request["validation"],
                "candidate": function_args,
            }
            if request.get("expectedUnrepairableReason") is not None:
                payload["expectedUnrepairableReason"] = request["expectedUnrepairableReason"]
            completed = subprocess.run(
                [
                    _fd_path(node_fd),
                    "--import",
                    _fd_path(tsx_fd),
                    _fd_path(validator_fd),
                ],
                input=json.dumps(payload, separators=(",", ":")),
                text=True,
                capture_output=True,
                timeout=request["validatorTimeoutSeconds"],
                check=True,
                pass_fds=(validator_fd, node_fd, tsx_fd),
                env={"PATH": request["path"], "HOME": request["home"], "LANG": "C.UTF-8"},
            )
            result = json.loads(completed.stdout)
            if not isinstance(result, dict) or result.get("submissionNumber") != 1:
                raise RuntimeError("invalid validator submission receipt")
            result = {**result, "submissionNumber": len(calls) + 1}
        calls.append({"candidate": function_args, "result": result})
        return json.dumps(result, separators=(",", ":"))

    run_agent.get_tool_definitions = definitions
    run_agent.handle_function_call = dispatch
    from agent.transports.codex import ResponsesApiTransport

    original_build_kwargs = ResponsesApiTransport.build_kwargs

    def build_kwargs(self: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        output = original_build_kwargs(self, *args, **kwargs)
        if output.get("tools"):
            last_valid = bool(calls and calls[-1]["result"].get("valid") is True)
            output["tool_choice"] = "none" if last_valid or len(calls) >= 2 else "required"
            output["parallel_tool_calls"] = False
        return output

    ResponsesApiTransport.build_kwargs = build_kwargs
    return calls


def _agent_tools(agent: Any) -> list[str]:
    return [item["function"]["name"] for item in agent.tools]


def _restore_isolated_environment(snapshot: dict[str, str], session_id: str) -> None:
    os.environ.clear()
    os.environ.update(snapshot)
    os.environ["HERMES_SESSION_ID"] = session_id


def main() -> int:
    os.environ["HERMES_SAFE_MODE"] = "1"
    os.environ["HERMES_IGNORE_USER_CONFIG"] = "1"
    os.environ["HERMES_IGNORE_RULES"] = "1"
    isolated_environment = dict(os.environ)
    args = _parser().parse_args()
    hermes_root = Path(_fd_path(args.hermes_root_fd))
    site_packages = Path(_fd_path(args.site_packages_fd))
    if not hermes_root.is_dir() or not site_packages.is_dir():
        raise RuntimeError("invalid Hermes import directories")
    sys.path.insert(0, str(site_packages))
    sys.path.insert(0, str(hermes_root))
    request = json.load(sys.stdin) if not args.inspect_tools else {
        "originalOutput": "",
        "validation": {},
        "nodeExecutable": sys.executable,
        "validatorTimeoutSeconds": 1,
        "path": "",
        "home": "",
    }
    import run_agent
    from hermes_cli.runtime_provider import resolve_runtime_provider

    calls = _patch_singleton_tools(run_agent, request, args.validator_fd, args.node_fd, args.tsx_fd)
    if args.inspect_tools:
        agent = run_agent.AIAgent(
            api_key="x",
            base_url="http://127.0.0.1:1/v1",
            provider="openai",
            model=args.model,
            enabled_toolsets=[],
            quiet_mode=True,
            max_iterations=3,
            skip_context_files=True,
            load_soul_identity=False,
            skip_memory=True,
            skip_background_review=True,
            ephemeral_system_prompt="Isolated JSON repair formatter.",
        )
        try:
            print(json.dumps({"availableTools": _agent_tools(agent)}))
        finally:
            agent.close()
        return 0

    try:
        runtime = resolve_runtime_provider(requested=args.provider, target_model=args.model)
    except Exception as error:
        print(json.dumps({"launcher_failure": "runtime", "error_type": type(error).__name__}))
        return 0
    try:
        agent = run_agent.AIAgent(
        api_key=runtime.get("api_key"),
        base_url=runtime.get("base_url"),
        provider=runtime.get("provider"),
        requested_provider=runtime.get("requested_provider"),
        api_mode=runtime.get("api_mode"),
        model=args.model,
        enabled_toolsets=[],
        quiet_mode=True,
        max_iterations=3,
        skip_context_files=True,
        load_soul_identity=False,
        skip_memory=True,
        skip_background_review=True,
        credential_pool=runtime.get("credential_pool"),
        fallback_model=None,
        ephemeral_system_prompt=(
            "You are an isolated JSON representation repairer. You have exactly one tool. "
            "Call validate_repair_json with the complete envelope you intend to submit. "
            "You may make one correction after deterministic feedback. Do not use prose as output."
        ),
        platform="cli",
            session_id=f"repair-{uuid.uuid4().hex}",
        )
    except Exception as error:
        print(json.dumps({"launcher_failure": "agent-construction", "error_type": type(error).__name__}))
        return 0
    _restore_isolated_environment(isolated_environment, agent.session_id)
    try:
        if _agent_tools(agent) != [TOOL_NAME]:
            raise RuntimeError("singleton tool inventory not proven")
        try:
            try:
                with open(os.devnull, "w", encoding="utf-8") as devnull:
                    with redirect_stdout(devnull), redirect_stderr(devnull):
                        result = agent.run_conversation(request["prompt"])
            finally:
                _restore_isolated_environment(isolated_environment, agent.session_id)
        except Exception as error:
            print(json.dumps({"launcher_failure": "agent-run", "error_type": type(error).__name__, "tool_calls": len(calls)}))
            return 0
        output = {
            "provider": runtime.get("provider"),
            "model": args.model,
            "input_tokens": result.get("input_tokens"),
            "output_tokens": result.get("output_tokens"),
            "api_calls": result.get("api_calls"),
            "tool_calls": len(calls),
            "available_tools": _agent_tools(agent),
            "calls": calls,
            "final_response": result.get("final_response") or "",
            "session_id": agent.session_id,
            "completed": bool(result.get("completed")),
            "failed": bool(result.get("failed")),
            "partial": bool(result.get("partial")),
            "safe_mode": os.environ.get("HERMES_SAFE_MODE") == "1",
            "user_config_ignored": os.environ.get("HERMES_IGNORE_USER_CONFIG") == "1",
            "rules_ignored": os.environ.get("HERMES_IGNORE_RULES") == "1",
            "inline_prompt": isinstance(request.get("prompt"), str) and bool(request["prompt"]),
            "cwd_isolated": len(os.listdir(os.getcwd())) == 0,
            "environment_allowlisted": os.environ.get("HERMES_SESSION_ID") == agent.session_id and set(os.environ).issubset({"PATH", "HOME", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR", "HERMES_SAFE_MODE", "HERMES_IGNORE_USER_CONFIG", "HERMES_IGNORE_RULES", "HERMES_SESSION_ID"} | {key for key in os.environ if key.startswith("LC_")}),
        }
        print(json.dumps(output, separators=(",", ":")))
    finally:
        agent.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
