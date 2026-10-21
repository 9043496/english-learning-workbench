# English Learning Workbench: agent entry

This is a distributable 2.1 learning platform plus six teaching skills. Read this file before installing or teaching.

## Install for the current user

1. Verify Python 3.10+. Run `python3 scripts/install.py --skills auto` from the repository. The installer is local and idempotent; it preserves existing config and refuses to overwrite unrelated skills. If no agent host is detected, use `--skills codex`, `claude`, `hermes`, or `none` explicitly.
2. Read the returned private config path. Run `python3 scripts/doctor.py --config <path>` and `python3 scripts/run.py --config <path> --open`. Keep this process running. Dependencies such as Node/ffmpeg are optional for the basic UI and required for the corresponding tests/audio tools.
3. Open the returned `/open-local` address, confirm health, four navigation areas and the empty-material state. An empty install is intentional: no personal curriculum, answers or recordings ship with this repository.
4. Confirm the learner profile and authorized content/audio sources before making lessons. Read `skills/english-learning-daily/SKILL.md` and follow its chain. If skill discovery is unavailable, read these files directly.

## Operate safely

- Default local service binds loopback. Do not expose its shared local token publicly or set a public bind without an approved HTTPS/authentication design. iPhone recording requires trusted HTTPS; see docs/cloud.md.
- Data, local config, provider credentials, answers and audio belong outside this repository. Use `WORKBENCH_CONFIG` to pass the private config location to agent tools; never commit this file or print its secret fields.
- Cloud mode uses each operator's own project and authorized coach account. The browser never receives an admin/service-role key. Follow docs/cloud.md; cloud deployment and recurring schedules require explicit user authorization.
- Upload/download are explicit. Do not fabricate work, grades, familiarity, course completion or a working audio service. Preserve immutable curriculum IDs and the learner's original submissions.
- Teaching defaults are a starting profile, not universal requirements. Confirm goals/level and missing rubrics. Human-authored licensed materials are preferred; AI-authored/adapted material must be labeled accurately.
- Keep the fixed four-section UI and monthly testing. `preview-2.0/` is an experimental isolated review, not the default production entry.
- Report the cases, environment/version, results and limits of verification. Node/jsdom/synthetic audio do not establish real-device Safari/Chrome or microphone usability.

## Validation

`npm ci && npm test`; `npm run test:integration`; `python3 -B -m unittest discover -s local -p 'test_*.py'`; `python3 -B -m unittest discover -s scripts/tests`; `cd cloud && npm ci && npm test`. Agent audio validation additionally uses ffmpeg/ffprobe on PATH.
