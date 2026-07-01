# Expeditionstagebuch Core 3.2

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

## Core 3.2 – GPS & Tracking
- Eigene GPS-Rubrik
- GPS starten, pausieren, fortsetzen, speichern
- Live-Track grün auf der Expeditionskarte
- aktuelle Position als Discovery-Marker
- gespeicherte Tracks dauerhaft pro Expedition
- Wake Lock während aktivem Tracking
- GPX-Export pro Track

## Core 3.2 – GPS Praxistest
- GPS-Status klarer markiert: bereit, aktiv, pausiert, Fehler.
- Debug-Zeile mit letztem GPS-Punkt, Genauigkeit und Zeit.
- Track-Speicherung zeigt klar, ob gespeichert wurde.
- Track-Zähler im GPS-Bereich.
- Keine neuen Großmodule.

## Core 3.2 – Kamera und Fotos
- Direkte Kameraaufnahme für Journal-Einträge.
- Direkte Kameraaufnahme für POIs.
- Mehrfachauswahl aus Galerie für Journal und POIs.
- Fotoanzahl und Galerieansicht verbessert.
- Hinweis im GPS-Bereich: Hintergrundtracking ist in der PWA eingeschränkt.

## Core 3.2 – Reise-Build
- Expeditionskarte mit Layern: geplante Route, gefahrene Tracks, POIs, Live-Position.
- POIs direkt auf der Karte per langem Druck anlegen.
- POI-Kategorien mit Symbolen: Camping, Kajak, Diesel, Fotospot, Restaurant, Geheimtipp.
- Reisechronik aus Tracks, POIs, Journal, Fotos und Reisekasse.
- Routensuche: Park4Night, Campspace, Supermarkt, Bäckerei, Tankstelle, Restaurant.
- Kartenbuttons: Auf Position, aktive Etappe, gesamte Reise.

## Core 3.2 – Planungseditor
- Ortsnamen können per Geocoding in Koordinaten umgewandelt werden.
- Nominatim/OpenStreetMap Suche mit bis zu 5 Treffern.
- Bekannte Reiseorte werden zusätzlich lokal erkannt.
- Speichern wird verhindert, wenn Start/Ziel ungültige Koordinaten haben.
- Routing wird verhindert, wenn Koordinaten fehlen.

## Core 3.2 – Speicherstabilität
- Fotos werden in IndexedDB gespeichert statt in localStorage.
- Bestehende localStorage-Fotos werden automatisch migriert.
- Journal- und POI-Fotos nutzen die neue Speicherung.
- Speicherstatus im Dashboard.
- Keine neuen Reise-Features; Fokus auf Stabilität.

## Core 3.2 – Planungsmodul ersetzt
- Planungseditor zentral ersetzt statt nur überschrieben.
- Geocoding-Auswahl wird mit echten Event-Listenern erzeugt.
- Speicherbutton ist fest verdrahtet.
- Pro Etappe wählbar: globale Einstellung, Autobahn erlaubt, Autobahn vermeiden, Luftlinie.
- renderPlanning, drawStageMap und rebuildStageMaps werden zentral ersetzt.
- Neue Etappen bekommen direkt eine Minikarte mit Start/Ziel bzw. Luftlinie.
