---
description: Keep all agent file access inside this backend workspace
alwaysApply: true
---

Never read or write any file via an absolute path that resolves outside this workspace folder (c:\Dev\EPickup-app\backend). If work touches a sibling repo (customer-app, shop-app, driver-app, admin-dashboard), tell the user explicitly — do not attempt to reach it directly, even if a path is known from earlier context.
