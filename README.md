# Avatar Inspector

Browser extension MVP, ktery funguje jako lokalni profilovy checklist duveryhodnosti.

Misto jednorazoveho verdiktu nad jednou fotkou si pro kazdy rozpoznany profil uklada:

- platformu a identitu profilu
- manualni checklist identity a chovani
- socialni signaly zachycene na strance
- poznamky psane uzivatelem
- vysledek analyzy profilove fotky

Vsechno zustava pouze lokalne v ulozisti rozsireni.

## Aktualni MVP

- rozpozna zakladni profilove stranky pro `facebook`, `instagram`, `discord`, `telegram`, `reddit`
- zalozi lokalni zaznam profilu v `storage.local`
- umozni rucne zatrhavat checklist identity, socialnich signalu a chovani
- umi ulozit volnou poznamku k profilu
- umi analyzovat profilovou fotku a pridat automaticke indikatory
- zachova puvodni kontextove menu `Analyze Image` pro rucni analyzu libovolneho obrazku

## Instalace pro vyvoj

1. Spust `npm install`
2. Spust `npm run sync:vendor`
3. Nacti extension jako unpacked / temporary addon

## Kvalita kodu

- `npm run lint` spusti ESLint nad JavaScriptem v projektu
- `npm run format:check` overi formatovani pres Prettier
- `npm run format` upravi format souboru podle konfigurace

## Build balicku pro Firefox

1. Spust `npm install`
2. Spust `npm run sync:vendor`
3. Spust `npm run build:firefox`
4. Hotovy balicek najdes v `dist/AvatarInspector-firefox.xpi`

Build zkopiruje jen soubory potrebne pro beh rozsireni, takze vysledny balicek neni zavisly na `node_modules`.

## Jak nacist do Chrome

1. Otevri `chrome://extensions`
2. Zapni `Developer mode`
3. Klikni na `Load unpacked`
4. Vyber slozku projektu `AvatarInspektor`

## GitHub Releases

- workflow `.github/workflows/release-firefox.yml` sestavi `.xpi` pri vytvoreni tagu `v*`
- stejny workflow lze spustit i rucne pres `workflow_dispatch`
- hotovy balicek se nahraje jako artifact a u tagu i jako asset do GitHub Release

## Jak otestovat

1. Otevri podporovanou profilovou stranku
2. Otevri popup rozsireni
3. Zkontroluj, ze se nacetl profil a checklist
4. Klikni na `Analyzovat profilovou fotku`
5. Pridej poznamku nebo uprav manualni checkboxy

## Poznamky

- uloziste je zatim implementovane pres `storage.local`, ne pres IndexedDB
- heuristiky detekce profilu jsou zamerne jednoduche a budou potrebovat ladeni po sitich
- Discord a Facebook maji nejslabsi detekci, protoze struktura DOM se casto meni
