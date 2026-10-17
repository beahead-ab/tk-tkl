#
# Script that checks if MQTT has an connection active
# Written by Benny Tjäder 2024
#
# CheckMqtt.py
#
import jmri

# Look for the Mqtt adapter
try:        mqttAdapter = jmri.InstanceManager.getDefault(jmri.jmrix.mqtt.MqttSystemConnectionMemo).getMqttAdapter()
except:     mqttAdapter = False

globalVariables = jmri.InstanceManager.getDefault(jmri.jmrit.logixng.GlobalVariableManager)
gVar            = globalVariables.getGlobalVariable('mqttUseMqtt')

if (mqttAdapter):   gVar.setValue('Ja')
else:               gVar.setValue('Nej')

sensors.getSensor('getConfig').setKnownState(ACTIVE) # ACTIVE = 2