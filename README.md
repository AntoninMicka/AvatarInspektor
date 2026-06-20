# Avatar Inspector

Minimalni MVP browser extension pro analyzu obrazku z kontextoveho menu.

## Co uz umi

- prida polozku `Analyze Image` do praveho tlacitka nad obrazkem
- nacte URL obrazku a zakladni DOM kontext
- zkontroluje jednoduche zdrojove indikatory podle `rules.json`
- vyhodnoti zakladni rozmery obrazku
- ulozi posledni analyzu a zobrazi ji v popupu

## Jak nacist do Chrome

1. Otevri `chrome://extensions`
2. Zapni `Developer mode`
3. Klikni na `Load unpacked`
4. Vyber slozku projektu `AvatarInspektor`

## Jak otestovat

1. Otevri stranku s obrazkem
2. Klikni pravym tlacitkem na obrazek
3. Zvol `Analyze Image`
4. Otevri popup rozsireni v liste prohlizece

## Poznamky

- EXIF/IPTC/XMP analyza zatim neni pripojena
- Firefox kompatibilita zatim neni overena
- jde o nactitelnou kostru, ne o finalni produkcni verzi
