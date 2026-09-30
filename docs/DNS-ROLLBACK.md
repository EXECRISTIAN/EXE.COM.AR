# DNS de exe.com.ar antes del pase a GitHub Pages (2026-09-30)

Zona Cloudflare 36f6a426b6466fc2e2a8b1678878b83d. Para volver atrás, restaurar:

- A exe.com.ar → 75.119.204.102 (DNS only)
- A www.exe.com.ar → 75.119.204.102 (DNS only)

Sin tocar (correo y otros): ftp/ssh A 75.119.204.102, mail A 64.90.62.162, mailboxes 69.163.136.97,
webmail 69.163.136.138, MX mailchannels, SPF, resend DKIM, send.* (SES), autoconfig, rsend, SRV autodiscover.
