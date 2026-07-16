# CI in attesa di attivazione

`ci.yml` è pronto ma NON attivo: GitHub rifiuta la creazione di file in
`.github/workflows/` da token senza scope `workflow` (quello locale non ce l'ha,
e le deploy key non possono comunque toccare i workflow).

Per attivarlo (una volta sola, ~1 minuto):

1. `gh auth refresh -h github.com -s workflow`  (apre il browser, conferma)
2. `git mv .github/workflows-pending/ci.yml .github/workflows/ci.yml`
3. `git commit -m "CI: attiva workflow" && git push`

Le Actions variables `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
sono già impostate sul repo.
