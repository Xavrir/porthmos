# Voiceover: licences

The voiceover is rendered locally with **Chatterbox** by Resemble AI. Nothing is sent to a remote service.

| Part | Version | Licence | Source |
|:-|:-|:-|:-|
| Code: `chatterbox-tts` | 0.1.7 (PyPI) | MIT, (c) 2025 Resemble AI | github.com/resemble-ai/chatterbox |
| Weights: `ResembleAI/chatterbox` (`t3_cfg`, `s3gen`, `ve`, `tokenizer.json`, `conds.pt`) | revision `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18` | MIT (model card `license: mit`) | huggingface.co/ResembleAI/chatterbox |
| Watermark: `resemble-perth` | from the venv | MIT, (c) 2025 Resemble AI | github.com/resemble-ai/perth |
| `s3tokenizer`, `transformers`, `diffusers` | pinned by chatterbox-tts | Apache 2.0 | PyPI |
| `conformer` | 0.3.2 | MIT | PyPI |

MIT allows commercial use, change and distribution. Keep the copyright notice with any copy of the code or weights. The film audio itself carries no licence condition.

**Watermark.** Chatterbox adds an inaudible Perth watermark to every output. It survives MP3 and editing. Do not try to remove it.

**Reference voice.** The cloned voice is a family member of the team, recorded with her consent, and used only for this film's voiceover. The reference recording is not in this repository; `gen.py` reads it from a local path (`--ref`, or the `PORTHMOS_VO_REF` environment variable). Do not reuse the voice or the rendered lines for another purpose.

**Local setup.** `uv venv video/voice/.venv --python 3.12`, then `uv pip install --python video/voice/.venv/bin/python chatterbox-tts==0.1.7`. The weights go in `video/voice/models/chatterbox/` (gitignored).
