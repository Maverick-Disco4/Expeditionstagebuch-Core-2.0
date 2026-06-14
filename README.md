# Expeditionstagebuch Core 2.0

Neu aufgebaut, nicht als Patch.

## Enthalten
- Mehrere Expeditionen
- Korrektes Etappenmodell: Start, Ziel, Typ
- Fahretappen und Aufenthalt/Rundtag
- OSRM-Routing ohne Key
- OpenRouteService optional mit Autobahnvermeidung
- Vereinfachte Routengeometrie, um Speicherfehler zu vermeiden
- Etappen-Minikarten
- Große Expeditionskarte
- Journal
- POIs
- Mehrfachfoto-Upload im Journal, komprimiert
- Reisekasse
- Backup Import/Export
- PWA-Installation

## Wichtige Designentscheidung
Routen werden vereinfacht gespeichert. Keine vollständigen Langstrecken-Geometrien mehr im lokalen Speicher.

## Core 2.1a – GPS & Tracking
- Eigene GPS-Rubrik
- GPS starten, pausieren, fortsetzen, speichern
- Live-Track grün auf der Expeditionskarte
- aktuelle Position als Discovery-Marker
- gespeicherte Tracks dauerhaft pro Expedition
- Wake Lock während aktivem Tracking
- GPX-Export pro Track
