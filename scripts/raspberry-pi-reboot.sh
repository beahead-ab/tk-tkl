#!/bin/sh
# Läses av Pi-installeraren först när installationens startkontroll är godkänd.
# Argument: systemd tillgänglig, datorns modell, föregående version (tom vid första installationen).
schedule_pi_reboot() {
  [ "${CDA_TKL_REBOOT:-1}" = 1 ] || return 0
  [ "$1" = true ] && [ -z "$3" ] || return 0
  case "$2" in 'Raspberry Pi '*) ;; *) return 0 ;; esac
  if shutdown -r +1 "TKL är installerat. Raspberry Pi startar om för att slutföra installationen."; then
    echo "Installationen är klar. Pi:n startar om automatiskt om en minut."
    echo "SSH-förbindelsen bryts vid omstarten. Vänta tills Pi:n har startat igen."
    echo "Avbryt den planerade omstarten vid behov med: sudo shutdown -c"
  else
    echo "Installationen är klar, men automatisk omstart kunde inte beställas. Kör: sudo reboot" >&2
    return 1
  fi
}
