#
# Script contain one classes:
# blMqttListener            class handles receiving of MQTT used for Block Signaling
#
# Written by Benny Tjäder 2024
#
# BlockSignaling.py
#
#
# MQTT topics supported by Block Signaling project
#
# Example of how to define and how to receive MQTT messages
#
# To see the result run the ReceiveMqttMessage.py script 
# or use e.g. (your broker and channel may vary)
#     mosquitto_sub -v -h 'test.mosquitto.org' -t '/trains/#'
#
# MQTT Status messages received are of type signal,block and traffic.
#
# Status messages for block signaling
# node-id is own nodeId
# timestamp is unix timestamp
# version is 1.0
#
# Topic
# dt/h0/signal/tk/42
#
# dt:       status
# h0:       scale
# signal:   type (block|node|ping|route|sensor|signal|switch|traffic|tam)
# tk:       node-id (tk is Träkvista)
# 42:       port-id (signal 42)
#
# Body
#
# is a json object
# In dt messages, mandatory parameters are:     node-id, version, port-id, state and timestamp
# In dt messages, optional parameters are:      track and identity
#
# Signals
#
# Reported state:   {d80|d80w80|d80wstop|d80w40|d40|d40short|d80v|d40v|drt|drtv|drtf|stop}
# Reported track:   {left|right}                If missing, single track or left is assumed
#
# topic:    dt/h0/signal/tk/{signal}
# body:     {"signal":{"node-id":"tk","version":"1.0","port-id":"{signal}","track":"{track}","state":{"reported":"{state}"},"timestamp":1705838370}}
#
# Blocks
#
# Reported state:   {occupied|free}
# Reported track:   {left|right}                If missing, single track or left is assumed
# Reported train:   {-|1234}                    If missing, no content of the block
#
# topic:    dt/h0/block/tk/{block}
# body:     {"block":{"node-id":"tk","version":"1.0","port-id":"{block}","track":"{track}","identity":"{train}","state":{"reported":"{state}"},"timestamp":1705838371}}
#
# Traffic
#
# Reported state:   {in|out|stopped}            stopped is when no traffic can be received or sent
# Reported track:   {left|right}                If missing, single track or left is assumed
# Reported train:   {-|1234}                    If missing, only direction change announced
#
# topic:    dt/h0/traffic/tk/{exit}
# body:     {"traffic":{"node-id":"tk","version":"1.0","port-id":"{exit}","track":"{track}","identity":"{train}","state":{"reported":"{state}"},"timestamp":1705838373}}
#
# Ex of configuration received from config server on reequest: http://mqtt-broker.local/?id=tk
#
#{                                              logixNG Global Variable
#	"id":"tk",
#	"config":{
#		"signature":"TK",
#		"name":"Tr\u00e4kvista",
#       "ctc":"fjb",
#		"destinations":2,
#		"destination":{
#			"A":{
#				"tracks":1,
#				"type":"single",
#				"single":{
#					"id":"blo",                 <- confConnections{'A'}{"id"}
#					"tracks":1,
#					"exit":"B",                 <- confConnections{'A'}{"exit"}
#					"track":"left",
#					"distance":1,               <- confConnections{'A'}{"distance"}
#					"signature":"BLO",
#					"name":"Bilbo",
#					"signalin":"22",            <- confConnections{'A'}{"signalin"}
#					"signalout":"U1",           <- confConnections{'A'}{"signalout"}
#					"blockout":"sa1"            <- confConnections{'A'}{"blockout"}
#				}
#			},
#			"B":{
#				"tracks":1,
#				"type":"single",
#				"single":{
#					"id":"tambox-1",            <- confConnections{'B'}{"id"}
#					"tracks":1,
#					"exit":"A",                 <- confConnections{'B'}{"exit"}
#					"track":"left",
#					"distance":2,               <- confConnections{'B'}{"distance"}
#					"signature":"CDA",
#					"name":"Charlottendal",
#					"signalin":"1.1",           <- confConnections{'B'}{"signalin"}
#					"signalout":"1.10",         <- confConnections{'B'}{"signalout"}
#					"blockout":"sa2"            <- confConnections{'B'}{"blockout"}
#				}
#			}
#		}
#	},
#}
#
import java
import jmri
import time
import json

debug = True        # debug text is written in the console

# Look for the Mqtt adapter
try:        mqttAdapter = jmri.InstanceManager.getDefault(jmri.jmrix.mqtt.MqttSystemConnectionMemo).getMqttAdapter()
except:     mqttAdapter = False

#----------------------------------------------------------------------------------------------------------------------------------------------------------------
# Listening class for incomming MQTT messages
#----------------------------------------------------------------------------------------------------------------------------------------------------------------
class bsMqttListener(jmri.jmrix.mqtt.MqttEventListener):

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Initialization
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def __init__(self):
        print 'Block signaling MQTT Listener started'

        return

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Get destination (track in/out)
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getModuleConnections(self):
        try:    conn = self.getGvar('confModuleConnections')
        except: conn = None

        return conn

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Get modul name of connected modules
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getModuleName(self, m):
        return self.getGvar('confConnections')[m]['id']

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Get JMRI main signal aspect
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getSigAspect(self, m):
        if   (m == self.getGvar('mqttAspectClear80')):              return 'Clear 80'
        elif (m == self.getGvar('mqttAspectClear80Expect40')):      return 'Clear 80 Expect 40'
        elif (m == self.getGvar('mqttAspectClear80Expect80')):      return 'Clear 80 Expect 80'
        elif (m == self.getGvar('mqttAspectClear80ExpectStop')):    return 'Clear 80 Expect Stop'
        elif (m == self.getGvar('mqttAspectClear40')):              return 'Clear 40'
        elif (m == self.getGvar('mqttAspectClear40Short')):         return 'Clear 40 Short Entry Route'
        else:                                                       return 'Stop'

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Get Global varible, returns None if not found
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getGvar(self, var):
        globalVariables     = jmri.InstanceManager.getDefault(jmri.jmrit.logixng.GlobalVariableManager)
        try:    val         = globalVariables.getGlobalVariable(var).getValue()
        except: val         = None

        return val

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Set Global varible, returns False if not found
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def setGvar(self, var, val):
        globalVariables     = jmri.InstanceManager.getDefault(jmri.jmrit.logixng.GlobalVariableManager)
        res = True
        try:    globalVariables.getGlobalVariable(var).setValue(val)
        except: res         = False

        return res

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Search and find a sensor, returns None if not found
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def findSensor(self, s):
        res = None
        for p in sensors.getNamedBeanSet():
            if (p.getUserName() == s):
                res = p.getUserName()
                break

        return res

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Fetch sensor state
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getSensorState(self, s):
        return sensors.getSensor(s).getKnownState()

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Fetch sensor state
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def setSensorState(self, s, state):
        return sensors.getSensor(s).setKnownState(state)

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Incomming MQTT message
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def notifyMqttMessage(self, topic, message):
        if (debug):                                                                                                                 print 'Block signaling Mqtt message -----------------'

        dtTopic                 = self.getGvar('mqttReport')+'/'+self.getGvar('mqttScale')+'/'
        allMandatoryPar         = True
        m                       = None
        jsonPayload             = json.loads(message)

        # Get body message type
        try:  body              = jsonPayload[self.getGvar('mqttTypeSignal')]                                                       # Signal body message type
        except:
            try: body           = jsonPayload[self.getGvar('mqttTypeBlock')]                                                        # Block body message type
            except:
                try: body       = jsonPayload[self.getGvar('mqttTypeTraffic')]                                                      # Traffic body message type
                except: body    = None                                                                                              # Unsupported body message type

        if (debug):                                                                                                                 print '--Message:', topic, 'with', message, 'received from Broker'

        if (body is not None):                                                                                                      # Valid body message type
        # Get mandatory body parameters
            try: version        = body[self.getGvar('mqttBodyVersion')]
            except:
                allMandatoryPar = False                                                                                             # Missing mandatory body parameter

            try: nodeId         = body[self.getGvar('mqttBodyNodeId')]
            except:
                allMandatoryPar = False                                                                                             # Missing mandatory body parameter

            try: portId         = body[self.getGvar('mqttBodyPortId')]
            except:
                allMandatoryPar = False                                                                                             # Missing mandatory body parameter

            try: bReported      = body[self.getGvar('mqttBodyState')][self.getGvar('mqttBodyStateReported')]
            except:
                allMandatoryPar = False                                                                                             # Missing mandatory body parameter

        # Get optional body parameters
            try:    track       = body[self.getGvar('mqttBodyTrack')]
            except: track       = None                                                                                              # Missing optional body parameter

            try:    identity    = body[self.getGvar('mqttBodyIdentity')]
            except: identity    = None                                                                                              # Missing optional body parameter

            for conn in self.getGvar('confModuleConnections'):
                if (nodeId and nodeId == self.getGvar('confConnections')[conn]['id']): m = conn

            if (allMandatoryPar and m is not None):                                                                                 # All mandatory parameters in the body and correct sending node-id
                if (float(version) == float(self.getGvar('mqttUsedBodyVersion'))):                                                  # Correct body version
                    if (dtTopic+self.getGvar('mqttTypeSignal') in topic):                                                           # Signal body type
                        if (debug):                                                                                                 print '--Signal:', nodeId, ':', portId, 'reported', bReported

                        if (portId == self.getGvar('confConnections')[m]['signalin']):
                            masts.getSignalMast(self.getGvar('confModuleObjects')[m]['signalin']).setAspect(self.getSigAspect(bReported))
                            if (debug):                                                                                             print 'In signal', portId, 'changed to', self.getSigAspect(bReported)

                        if (portId == self.getGvar('confConnections')[m]['signalout']):
                            masts.getSignalMast(self.getGvar('confModuleObjects')[m]['signalout']).setAspect(self.getSigAspect(bReported))
                            if (debug):                                                                                             print 'Out signal', portId, 'changed to', self.getSigAspect(bReported)

                    elif (dtTopic+self.getGvar('mqttTypeBlock') in topic):                                                          # Block body type
                        if (debug):                                                                                                 print '--Block:', nodeId, ':', portId, 'reported', bReported

                        if (portId == self.getGvar('confConnections')[m]['blockout']):
                            blockOut    = self.getGvar('confModuleObjects')[m]['blockout']
                            trafOut     = self.getGvar('confModuleObjects')[m]['trafficDirOut']
                            if (debug):                                                                                             print 'block:', blockOut

                            if (bReported == self.getGvar('mqttBlockActive')):                                                      # Block occupied, set train id if available
                                self.setSensorState(blockOut, ACTIVE)
                                if (debug):                                                                                         print blockOut, 'occupied'

                                if (identity is not None):                                                                          # Got train id for the block
                                    memories.provideMemory(self.getGvar('confModuleObjects')[m]['trainId']).setValue(identity)

                            elif (bReported == self.getGvar('mqttBlockInactive')):                                                  # block free
                                self.setSensorState(blockOut, INACTIVE)
                                if (debug):                                                                                         print blockOut, 'free'

                                if (self.getSensorState(trafOut) == ACTIVE):                                                        # Outgoing traffic clear Train id memory
                                    memories.provideMemory(self.getGvar('confModuleObjects')[m]['trainId']).setValue('-')

                    elif (dtTopic+self.getGvar('mqttTypeTraffic') in topic):                                                        # Traffic body type
                        if (debug):                                                                                                 print '--Traffic:', nodeId, '-', portId, 'reported', bReported
 
                        if (portId == self.getGvar('confConnections')[m]['exit']):
                            trafIn      = self.getGvar('confModuleObjects')[m]['trafficIn']
                            trafOut     = self.getGvar('confModuleObjects')[m]['trafficOut']
                            trafStop    = self.getGvar('confModuleObjects')[m]['trafficStopped']
                            if (debug):                                                                                             print 'trafIn:', trafIn, ',trafOut:', trafOut, ',trafStop:', trafStop

                            if (bReported == self.getGvar('mqttTrafficIn')):
                                self.setSensorState(trafIn, INACTIVE)
                                self.setSensorState(trafOut, ACTIVE)
                                self.setSensorState(trafStop, INACTIVE)
#                                    memories.provideMemory(self.getGvar('confModuleObjects')[m]['trainId']).setValue('-')
                                if (debug):                                                                                         print 'Traffic in on', m

                            elif (bReported == self.getGvar('mqttTrafficOut')):
                                self.setSensorState(trafIn, ACTIVE)
                                self.setSensorState(trafOut, INACTIVE)
                                self.setSensorState(trafStop, INACTIVE)
                                if (debug):                                                                                         print 'Traffic out on', m

#                                if (identity is not None):                                                                          # Got train id
#                                    memories.provideMemory(self.getGvar('confModuleObjects')[m]['trainId']).setValue(identity)

                            elif (bReported == self.getGvar('mqttTrafficStop')):
                                self.setSensorState(trafStop, ACTIVE)
                                if (debug):                                                                                         print 'Traffic stopped on', m

                    else:                                                                                                           # Not supported body type
                        if (debug):                                                                                                 print 'Wrong body type'

                else:                                                                                                               # Not supported body version
                    if (debug):                                                                                                     print 'Wrong version :', version, 'supported version <', self.mqttBodyVersion

            else:                                                                                                                   # The received body is missing mandatory parameters
                if (debug):                                                                                                         print 'Missing mandatory parameters'

        else:                                                                                                                       # The received body type is not supported
            if (debug):                                                                                                             print 'Unsupported body type'

        if (debug):                                                                                                                 print '----------------- message Mqtt Block signaling'; print ''

        return

#----------------------------------------------------------------------------------------------------------------------------------------------------------------
# Do Subscribe for MQTT topics for Block Signaling
#----------------------------------------------------------------------------------------------------------------------------------------------------------------
if (mqttAdapter):
    bsMqtt = bsMqttListener()

    mqttReport  = bsMqtt.getGvar('mqttReport')
    mqttScale   = bsMqtt.getGvar('mqttScale')
    mqttTypeSig = bsMqtt.getGvar('mqttTypeSignal')
    mqttTypeTra = bsMqtt.getGvar('mqttTypeTraffic')
    mqttTypeBlo = bsMqtt.getGvar('mqttTypeBlock')

    for m in bsMqtt.getModuleConnections():                                                                                         # Subscripe on Signal, Block and Traffic reports from configured connection
        nodeName = bsMqtt.getModuleName(m)
        mqttAdapter.subscribe(mqttReport+'/'+mqttScale+'/'+mqttTypeSig+'/'+nodeName+'/#', bsMqtt)
        mqttAdapter.subscribe(mqttReport+'/'+mqttScale+'/'+mqttTypeTra+'/'+nodeName+'/#', bsMqtt)
        mqttAdapter.subscribe(mqttReport+'/'+mqttScale+'/'+mqttTypeBlo+'/'+nodeName+'/#', bsMqtt)
        time.sleep(0.02)
