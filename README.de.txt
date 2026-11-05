Möchten Sie Ihr Auto immer im Blick haben und aus der Ferne steuern?
Diese App ist für Besitzer von Stellantis-Fahrzeugen (Peugeot, Citroën, DS und Opel). Sie gibt Ihnen Einblick in Ihr Auto und lässt Sie Befehle an das Auto senden.

Einblick:
- Batteriestand, Reichweite, Kilometerstand und Wartung (Tage und Kilometer).
- Batteriezustand (State of Health), sofern Ihr Auto ihn meldet. Die Flow-Aktion „Batteriezustand abrufen“ liefert ihn als Token; Tokens von Aktionen sind nur in Advanced Flows verwendbar.
- Ein Trigger für eine neue Fahrt mit Verbrauch, Strecke und Dauer der Fahrt.

Fernbefehle (Flow-Aktionen):
- Klimaanlage (Vorklimatisierung) starten und stoppen.
- Laden starten und stoppen. Hinweis: „Laden stoppen“ verschiebt den Start auf die programmierte Ladezeit; das Auto hat keinen echten Stoppbefehl.
- Das Fahrzeug aufwecken und den Status aktualisieren. Nützlich, denn das Auto meldet beim Laden keinen Fortschritt. Höchstens 6 pro 20 Minuten.
- Türen verriegeln und entriegeln, hupen und die Lichter blinken lassen.
- Den Fahrzeugstatus auf Anforderung aktualisieren.

Nicht jedes Auto unterstützt jeden Befehl. Was verfügbar ist, hängt von Ihrem Modell und Ihrem Connected-Services-Abonnement ab. Mit den Flow-Bedingungen „Remote-Dienst ist verfügbar“ und „Dienstcode ist verfügbar“ prüfen Sie das, bevor ein Befehl gesendet wird. Befehle, die Ihr Auto nicht unterstützt, schlagen mit einer klaren Meldung fehl. Das Starten der Klimaanlage wurde an einem Peugeot getestet; die anderen Befehle sind neu und funktionieren möglicherweise nicht bei jedem Auto.

Einrichtung:
Öffnen Sie die App-Einstellungen am PC bzw. im Browser und folgen Sie den Schritten:
1. Wählen Sie Marke und Land.
2. Melden Sie sich bei Ihrem Konto an.
3. Schließen Sie den Token-Schritt ab.
4. Bestätigen Sie mit einem per SMS gesendeten Einmalpasswort (OTP) und Ihrer PIN. Das ist für Fernbefehle nötig. Sie können den Schritt überspringen, wenn Sie nur Daten auslesen möchten.
Sie können auch direkt auf dem Startbildschirm mit „Request OTP“ oder „Refresh OTP“ beginnen. Der OTP-Dienst erlaubt 6 Anfragen pro 24 Stunden, fordern Sie also nicht mehr an als nötig.

Unterstützung für andere Autos:
Die Dienstcodes Ihres Autos stehen in den erweiterten Einstellungen des Geräts („Remote-Dienste dieses Fahrzeugs“). Teilen Sie diesen Text, wenn Sie Unterstützung für weitere Autos wünschen. Er enthält keine FIN.

Danksagung:
andreadegiovine auf GitHub für seine Home-Assistant-Integration
