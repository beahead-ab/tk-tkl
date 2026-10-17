#
# Script contain one class:
# tsMqttListener            class handles receiving of MQTT messages used for TAM Signaling
#
# Written by Benny Tjäder 2024
#
# TamSignaling.py
#
#
# MQTT topics supported to allow TAM signaling project
#
# Example of how to define and how to receive MQTT messages
#
# To see the result run the ReceiveMqttMessage.py script 
# or use e.g. (your broker and channel may vary)
#     mosquitto_sub -v -h 'test.mosquitto.org' -t '/trains/#'
#
# MQTT Command messages received is of type tam
#
# Status messages for TAM signaling
# node-id is own nodeId
# timestamp is unix timestamp
# version is 1.0
#
# Topic
# dt/h0/tam/tk/left
#
# dt:       status (cmd: command)
# h0:       scale
# tam:      type (block|node|ping|route|sensor|signal|switch|traffic|tam)
# tk:       node-id (tk is Träkvista)
# left:     port-id (track left)
#
# Body
# is a json object
#
# In dt messages, mandatory parameters are:     node-id, version, port-id, identity, state and timestamp
# In cmd messages, mandatory parameters are:    node-id, version, port-id, state, timestamp and session-id
# In cmd messages, optional parameters are:     identity
#
# TAM traffic
#
# Reported state:   {in|out}
# Reported train:   {-|1234}
#
# topic:    dt/h0/tam/tk/{track}
# body:     {"tam":{"node-id":"tk","version":"1.0","port-id":"{track}","identity":"{train}","state":{"reported":"{state}"},"timestamp":1705838373}}
#
# Ping
#
# ping is sent every 10 second
# Reported state:   {ping}
#
# topic:    dt/h0/ping/tk
# body:     {"ping":{"node-id":"tk","version":"1.0","state":{"reported":{state}},"timestamp":1705838352}}
#
# Command messages from TAM signaling
# node-id is own nodeId
# timestamp is unix timestamp
# session-id is a uniq identifyer
# respond-to is the sender node of the command
# version is 1.0
#
# TAM traffic direction request
# Desired state:    {in|out}
# Reported state:   {in|out}
#
# topic:    cmd/h0/tam/tk/{track}/req
# body:     {"tam":{"node-id":"{remoteNodeId}","version":"1.0","port-id":"{track}","respond-to":"cmd/h0/tam/{remoteNodeId}/res","state":{"desired":"{state}"},"session-id":"req:1705838143","timestamp":1705838143}}
#
# Example of a response sent back for a TAM traffic direction request
# topic:    cmd/h0/tam/{remoteNodeId}/res
# body:     {"tam":{"node-id":"tk","version":"1.0","port-id":"{track}","state":{"desired":"{state}","reported":"{state}"},"session-id":"req:1705838143","timestamp":1705838156}}
#
# TAM request
# Desired state:    {accept|cancel}
# Reported state:   {accepted|rejected}
# Reported train:   {-|1234}
#
# topic:    cmd/h0/tam/tk/{track}/req
# body:     {"tam":{"node-id":"{remoteNodeId}","version":"1.0","port-id":"{track}","identity":"{train},"respond-to":"cmd/h0/tam/{remoteNodeId}/res","state":{"desired":"{state}"},"session-id":"req:1705838143","timestamp":1705838143}}
#
# Example of a response sent back for a TAM request
# topic:    cmd/h0/tam/{remoteNodeId}/res
# body:     {"tam":{"node-id":"tk","version":"1.0","port-id":"{track}","identity","{train}","state":{"desired":"{state}","reported":"{state}"},"session-id":"req:1705838143","timestamp":1705838156}}
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
#					"exit":"B",
#					"track":"left",             <- confConnections{'A'}{"track"}
#					"distance":1,               <- confConnections{'A'}{"distance"}
#					"signature":"BLO",
#					"name":"Bilbo",
#					"signalin":"22",
#					"signalout":"U1",
#					"blockout":"sa1"
#				}
#			},
#			"B":{
#				"tracks":1,
#				"type":"single",
#				"single":{
#					"id":"tambox-1",            <- confConnections{'B'}{"id"}
#					"tracks":1,
#					"exit":"A",
#					"track":"left",             <- confConnections{'B'}{"track"}
#					"distance":2,               <- confConnections{'B'}{"distance"}
#					"signature":"CDA",
#					"name":"Charlottendal",
#					"signalin":"1.1",
#					"signalout":"1.10",
#					"blockout":"sa2"
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
class tsMqttListener(jmri.jmrix.mqtt.MqttEventListener):

    response            = {}
    request             = {}
    exitData            = {}
    sensorToggleDelay   = 1

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Initialization
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def __init__(self):
        print 'TAM signaling MQTT Listener started'
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
        res                 = True
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
    # Toggle sensor state, returns True if succesful and False if unsuccesful
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def toggleSensorState(self, s):
        if (sensors.getSensor(s).getKnownState() == ACTIVE):
            sensors.getSensor(s).setKnownState(INACTIVE)
            delay = self.sensorToggleDelay                                                                                          # Wait some seconds before response
            if (sensors.getSensor(s).getKnownState() == INACTIVE): res = True
            else: res = False

        elif (sensors.getSensor(s).getKnownState() == INACTIVE):
            sensors.getSensor(s).setKnownState(ACTIVE)
            delay = self.sensorToggleDelay                                                                                          # Wait some seconds before response
            if (sensors.getSensor(s).getKnownState() == ACTIVE): res = True
            else: res = False
        return res

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Update reported state the message response
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def updateMessageResponse(self, key, val, exit):
        self.exitData.update({key: val})
        self.response[exit] = self.exitData
        self.setGvar('messageResponse', self.response)
        return

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Add metadata to the message response
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def addMetaData(self, key, val, exit):
        metaData = {}
        metaData[key] = val
        self.exitData['metaData'] = metaData
        self.response[exit] = self.exitData
        self.setGvar('messageResponse', self.response)
        return

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Incomming MQTT message
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def notifyMqttMessage(self, topic, message):
        if (debug):                                                                                                                 print 'TAM signaling Mqtt message -----------------'

        cmdTopic                = self.getGvar('mqttCmd')+'/'+self.getGvar('mqttScale')+'/'
        dtTopic                 = self.getGvar('mqttReport')+'/'+self.getGvar('mqttScale')+'/'
        reportedState           = self.getGvar('mqttError')
        allMandatoryPar         = True
        m                       = None
        jsonPayload             = json.loads(message)

        # Get body message type
        try:
            mBodyType           = self.getGvar('mqttTypeTam')
            body                = jsonPayload[mBodyType]                                                                            # TAM body message type
        except:
            body                = None                                                                                              # Unsupported body message type

        if (debug):                                                                                                                 print '--Message:', topic, 'with', message, 'received from Broker'

        if (body is not None):                                                                                                      # Valid body message type
            if (cmdTopic in topic):
            # Get mandatory body parameters
                try:    version         = body[self.getGvar('mqttBodyVersion')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    nodeId          = body[self.getGvar('mqttBodyNodeId')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    portId          = body[self.getGvar('mqttBodyPortId')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    respondTo       = body[self.getGvar('mqttBodyRespondTo')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    sessionId       = body[self.getGvar('mqttBodySessionId')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    desiredState    = body[self.getGvar('mqttBodyState')][self.getGvar('mqttBodyStateDesired')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

            # Get optional body parameters
                try:    identity        = body[self.getGvar('mqttBodyIdentity')]
                except: identity        = "-"                                                                                       # Missing optional body parameter

            elif (dtTopic in topic):
            # Get mandatory body parameters
                try:    version         = body[self.getGvar('mqttBodyVersion')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    nodeId          = body[self.getGvar('mqttBodyNodeId')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    portId          = body[self.getGvar('mqttBodyPortId')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    reported        = body[self.getGvar('mqttBodyState')][self.getGvar('mqttBodyStateReported')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

                try:    identity        = body[self.getGvar('mqttBodyIdentity')]
                except: allMandatoryPar = False                                                                                     # Missing mandatory body parameter

            # Get optional body parameters
            try:    track       = body[self.getGvar('mqttBodyTrack')]
            except: track       = None                                                                                              # Missing optional body parameter

            for mc in self.getGvar('confModuleConnections'):
                if (nodeId and nodeId == self.getGvar('confConnections')[mc]['id']): m = mc

            if (allMandatoryPar and m is not None):                                                                                 # All mandatory parameters in the body
                if  (cmdTopic in topic):
                    self.response = self.getGvar('messageResponse')
                    self.exitData['track']          = track                                                                         # For the response
                    self.exitData['portId']         = portId                                                                        # For the response
                    self.exitData['respondTo']      = respondTo                                                                     # For the response
                    self.exitData['sessionId']      = sessionId                                                                     # For the response
                    self.exitData['reportedState']  = reportedState                                                                 # For the response
                    self.exitData['identity']       = identity                                                                      # For the response
                    self.exitData['desiredState']   = desiredState                                                                  # For the response
                    self.exitData['bodyType']       = mBodyType                                                                     # For the response
                    for key in self.exitData.keys():
                        if (key == 'metaData'): self.exitData.pop(key)
                    self.response[m] = self.exitData
                    self.setGvar('messageResponse', self.response)

                elif (cmdTopic in topic and self.getGvar('mqttResponse') in topic):
                    self.request = self.getGvar('messageCommand')

                if (float(version) == float(self.getGvar('mqttUsedBodyVersion'))):                                                  # Correct body version
                    if (cmdTopic+mBodyType+'/'+self.getGvar('nodeId') in topic):                                                    # Command TAM body type
                        if (self.getGvar('mqttRequest') in topic):                                                                  # Cmd request
                            if (debug):                                                                                             print '--TAM request:', nodeId, '-', portId, 'requested to', desiredState

                            if (portId == self.getGvar('confConnections')[m]['track']):
                                trafIn      = self.getGvar('confModuleObjects')[m]['trafficIn']
                                trafOut     = self.getGvar('confModuleObjects')[m]['trafficOut']
                                line        = self.getGvar('confModuleObjects')[m]['trackLine']
                                tamBusy     = self.getGvar('confModuleObjects')[m]['tamBusy']
                                tamRequest  = self.getGvar('confModuleObjects')[m]['tamRequest']

                                if (desiredState == self.getGvar('mqttTrafficIn')):                                                 # TAM traffic direction change
                                    if (self.getSensorState(line) == INACTIVE):                                                     # Line is free
                                        if (self.getSensorState(trafIn) == ACTIVE and
                                            self.getSensorState(trafOut) == INACTIVE):                                              # Correct Traffic direction
                                            self.toggleSensorState(tamBusy)
                                            reportedState = self.getGvar('mqttTamIn')
                                            if (debug):                                                                             print 'Traffic direction change accepted'

                                        elif (self.getSensorState(trafIn) == INACTIVE and
                                              self.getSensorState(trafOut) == ACTIVE):                                              # Incorrect Traffic direction
                                            self.toggleSensorState(trafIn)
                                            self.toggleSensorState(trafOut)
                                            self.toggleSensorState(tamBusy)
                                            reportedState = self.getGvar('mqttTamIn')
                                            if (debug):                                                                             print 'Traffic direction change accepted'

                                        elif (self.getSensorState(trafIn) == INACTIVE and
                                              self.getSensorState(trafOut) == INACTIVE):                                            # Traffic stopped
                                            reportedState = self.getGvar('mqttTamOut')
                                            if (debug):                                                                             print 'Traffic direction change rejected'

                                    else:                                                                                           # Line is busy
                                        reportedState = self.getGvar('mqttTamOut')
                                        if (debug):                                                                                 print 'Traffic direction change rejected'

                                elif (desiredState == self.getGvar('mqttTamAccept')):                                               # TAM request
                                    if (self.getSensorState(line) == INACTIVE and
                                        self.getSensorState(tamBusy) == ACTIVE):                                                    # Line is free
                                        if (self.getSensorState(trafIn) == ACTIVE and
                                            self.getSensorState(trafOut) == INACTIVE):                                              # Correct Traffic direction
                                            memories.provideMemory(self.getGvar('confModuleObjects')[m]['trainId']).setValue(identity)
                                            reportedState = self.getGvar('mqttTamAccepted')
                                            self.toggleSensorState(tamRequest)
                                            if (debug):                                                                             print 'Traffic in with train', identity, 'accepted'

                                        elif (self.getSensorState(trafIn) == INACTIVE and
                                              self.getSensorState(trafOut) == ACTIVE):                                              # Incorrect Traffic direction
                                            reportedState = self.getGvar('mqttTamRejected')
                                            if (debug):                                                                             print 'Traffic in with train', identity, 'rejected'

                                        elif (self.getSensorState(trafIn) == INACTIVE and
                                              self.getSensorState(trafOut) == INACTIVE):                                            # Traffic stopped
                                            reportedState = self.getGvar('mqttTamRejected')
                                            if (debug):                                                                             print 'Traffic in with train', identity, 'rejected'

                                    else:                                                                                           # Line is busy
                                        reportedState = self.getGvar('mqttTamRejected')
                                        if (debug):                                                                                 print 'Traffic in with train', identity, 'rejected'

                                else:                                                                                               # Unknown desired state
                                    self.addMetaData("error", "Unknown desired state")

                            else:                                                                                                   # Port id not found
                                self.addMetaData("error", "Port-id not found")
                                if (debug):                                                                                         print 'portId:', portId, 'not found'

                        elif (self.getGvar('mqttResponse') in topic):                                                               # Cmd response
                            if (debug):                                                                                             print '--TAM response:', nodeId, ':', portId, 'ordered to', desiredState

                        else:                                                                                                       # Not request or response
                            if (debug):                                                                                             print 'Not request or response'

                    elif (dtTopic+mBodyType in topic):                                                                              # Report TAM body type
                        if (debug):                                                                                                 print '--TAM report:', nodeId, ':', portId, 'reported', reported
 
                        if (portId == self.getGvar('confConnections')[m]['track']):
                            trafIn  = self.getGvar('confModuleObjects')[m]['trafficIn']
                            trafOut = self.getGvar('confModuleObjects')[m]['trafficOut']
                            tamBusy = self.getGvar('confModuleObjects')[m]['tamBusy']
                            if (debug):                                                                                             print 'trafIn:', trafIn, ',trafOut:', trafOut

                            if (reported == self.getGvar('mqttTrafficIn')):
                                if (debug):                                                                                         print 'Traffic in with train ', identity, ' report ', reported
                                self.toggleSensorState(tamBusy)

                            elif (reported == self.getGvar('mqttTrafficOut')):
                                if (debug):                                                                                         print 'Traffic in with train ', identity, ' report ', reported


                    else:                                                                                                           # Not TAM cmd or TAM dt
                        if (debug):                                                                                                 print 'Not TAM cmd or TAM dt'

                else:                                                                                                               # Unsupported body version
                    self.addMetaData("error", "Unsupported body version")
                    if (debug):                                                                                                     print 'Wrong version :', version, 'supported version <', self.getGvar('mqttBodyVersion')

            else:                                                                                                                   # The received body is missing mandatory parameters or wrong sending node-id
                self.addMetaData("error", "Missing mandatory parameters")
                if (debug):                                                                                                         print 'Missing mandatory parameters'

            self.updateMessageResponse('reportedState', reportedState, m)
            if (reportedState <> self.getGvar('mqttTamAccepted')):
                self.toggleSensorState('sendResponse'+m)

        else:                                                                                                                       # The received body type is not supported
            if (debug):                                                                                                             print 'Not TAM body'

        if (debug):                                                                                                                 print '----------------- message Mqtt TAM signaling'; print ''

        return

#----------------------------------------------------------------------------------------------------------------------------------------------------------------
# Do Subscribe for MQTT topics for TAM Signaling
#----------------------------------------------------------------------------------------------------------------------------------------------------------------
if (mqttAdapter):
    tsMqtt      = tsMqttListener()
    mqttReport  = tsMqtt.getGvar('mqttReport')
    mqttCmd     = tsMqtt.getGvar('mqttCmd')
    mqttScale   = tsMqtt.getGvar('mqttScale')
    nodeId      = tsMqtt.getGvar('nodeId')
    mqttType    = tsMqtt.getGvar('mqttTypeTam')

    mqttAdapter.subscribe(mqttCmd+'/'+mqttScale+'/'+mqttType+'/'+nodeId+'/#', tsMqtt)                   # Subscribe on TAM commands for own nodeId

    for m in tsMqtt.getModuleConnections():                                                             # Subscripe on TAM reports from configured connection
        nodeName = tsMqtt.getModuleName(m)
        mqttAdapter.subscribe(mqttReport+'/'+mqttScale+'/'+mqttType+'/'+nodeName+'/#', tsMqtt)
        time.sleep(0.02)
