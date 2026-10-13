"""Send the daily digest to yourself over SMTP (same app password as the inbox)."""
from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

from .config import Profile


def send_digest(profile: Profile, body: str, html_body: str | None = None) -> str:
    cfg = profile.inbox
    to = cfg.get("digest_to") or cfg.get("user")
    password = os.environ.get(cfg.get("password_env", "JOBHUNT_IMAP_PASSWORD"))
    if not (to and password):
        raise RuntimeError("set inbox.digest_to (or inbox.user) and the app password env var")
    msg = EmailMessage()
    msg["Subject"] = body.splitlines()[0]
    msg["From"] = cfg["user"]
    msg["To"] = to
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    with smtplib.SMTP_SSL(cfg.get("smtp_host", "smtp.gmail.com"), 465) as smtp:
        smtp.login(cfg["user"], password)
        smtp.send_message(msg)
    return to
