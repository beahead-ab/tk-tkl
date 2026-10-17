#
# Script contain one class:
# myMqttListener            class handles receiving of MQTT messages used for Remote Controling
#
# Written by Benny Tjäder 2024
#
# RemoteControl.py
#
#
# MQTT topics supported to allow remote control of the station
#
# Example of how to define and how to receive MQTT messages
#
# To see the result run the ReceiveMqttMessage.py script 
# or use e.g. (your broker and channel may vary)
#     mosquitto_sub -v -h 'test.mosquitto.org' -t '/trains/#'
#
# MQTT Command messages received is of type route
#
# Status messages for remote control
# node-id is own nodeId
# timestamp is unix timestamp
# version is 1.0
#
# Topic
# dt/h0/signal/tk/42
#
# dt:       status (cmd: command)
# h0:       scale
# signal:   type (block|node|ping|route|sensor|signal|switch|traffic|tam)
# tk:       node-id (tk is Träkvista)
# 42:       port-id (signal 42)
#
# Body
# is a json object
#
# In dt messages, mandatory parameters are:     node-id, version, port-id, state and timestamp
# In dt messages, optional parameters are:      track and identity
# In cmd messages, mandatory parameters are:    node-id, version, port-id, state, timestamp and session-id
#
# Routes
#
# Reported states: {active|inactive}
#
# topic:    dt/h0/route/tk/{route}
# body:     {"route":{"node-id":"tk","version":"1.0","port-id":"{route}","state":{"reported":"{state}"},"timestamp":1705838471}}
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
# Sensors
#
# Reported state:   {active|inactive}
#
# topic:    dt/h0/sensor/tk/{sensor}
# body:     {"sensor":{"node-id":"tk","version":"1.0","port-id":"{sensor}","state":{"reported":"{state}"},"timestamp":1705838632}}
#
# Ping
#
# ping is sent every 10 second
# Reported state:   {ping}
#
# topic:    dt/h0/ping/tk
# body:     {"ping":{"node-id":"tk","version":"1.0","state":{"reported":{state}},"timestamp":1705838352}}
#
# Command messages from remote control
# node-id is own nodeId
# timestamp is unix timestamp
# session-id is a uniq identifyer
# respond-to is the sender node of the command
# version is 1.0
#
# Reported state:   {set|clear}
#
# topic:    cmd/h0/route/tk/{route}/req
# body:     {"route":{"node-id":"{remoteNodeId}","version":"1.0","port-id":"{route}","respond-to":"cmd/h0/route/{remoteNodeId}/res","state":{"desired":"{state}"},"session-id":"req:1705838143","timestamp":1705838143}}
#
# Example of a response sent back for a command
# topic:    cmd/h0/route/{remoteNodeId}/res
# body:     {"route":{"node-id":"tk","version":"1.0","port-id":"{route}","state":{"desired":"{state}","reported":"{state}"},"session-id":"req:1705838143","timestamp":1705838156}}

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
class myMqttListener(jmri.jmrix.mqtt.MqttEventListener):

    swVersion           = ''
    startDone           = 'initStartDone'                                                                                           # Start done sensor
    sendResponse        = 'sendResponseFjb'                                                                                         # Send response sensor
    response            = {}
    fjbData	            = {}
    turnoutToggleDelay  = 5
    sensorToggleDelay   = 1
    
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Initialization
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def __init__(self):
        print 'Remote control MQTT Listener started'

        # Running JMRI version
        version         = jmri.Version.name()[0:jmri.Version.name().find('+')]
        self.setGvar('jmriSoftwareVersion', version)
        self.swVersion  = version
        return

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Fetch start done sensor
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getStartDone(self):
        return self.startDone

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Fetch send response sensor
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getSendResponse(self):
        return self.sendResponse

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
    # Search and find a turnout, returns None if not found
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def findTurnout(self, t):
        res = None
        for p in turnouts.getNamedBeanSet():
            if (p.getUserName() == t):
                res = p.getUserName()
                break
        return res

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Fetch turnout state
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getTurnoutState(self, t):
        return turnouts.getTurnout(t).getState()

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Toggle turnout state, returns True if succesful and False if unsuccesful
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def toggleTurnoutState(self, t):
        if (turnouts.getTurnout(t).getState() == CLOSED):
            turnouts.getTurnout(t).setState(THROWN)
            delay = self.turnoutToggleDelay                                                                                         # Wait some seconds before response
            if (turnouts.getTurnout(t).getState() == THROWN): res = True
            else: res = False

        elif (turnouts.getTurnout(t).getState() == THROWN):
            turnouts.getTurnout(t).setState(CLOSED)
            delay = self.turnoutToggleDelay                                                                                         # Wait some seconds before response
            if (turnouts.getTurnout(t).getState() == CLOSED): res = True
            else: res = False
        return res

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Update reported state the message response
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def updateMessageResponse(self, key, val):
        self.fjbData.update({key: val})
        self.response['fjb'] = self.fjbData
        self.setGvar('messageResponse', self.response)
        return

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Add metadata to the message response
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def addMetaData(self, key, val):
        metaData = {}
        metaData[key] = val
        self.fjbData['metaData'] = metaData
        self.response['fjb'] = self.fjbData
        self.setGvar('messageResponse', self.response)
        return

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Incomming MQTT message
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def notifyMqttMessage(self, topic, message):
        if (debug):                                                                                                                 print 'Remote control Mqtt message -----------------'

        cmdTopic                = self.getGvar('mqttCmd')+'/'+self.getGvar('mqttScale')+'/'
        reportedState           = self.getGvar('mqttError')
        allMandatoryPar         = True
        jsonPayload             = json.loads(message)

        # Get body message type
        try:
            mBodyType           = self.getGvar('mqttTypeRoute')
            body                = jsonPayload[mBodyType]                                                                            # Route body message type
        except:
            try:
                mBodyType       = self.getGvar('mqttTypeSwitch')
                body            = jsonPayload[mBodyType]                                                                            # Switch body message type
            except: body        = None                                                                                              # Unsupported body message type

        if (debug):                                                                                                                 print '--Message:', topic, 'with', message, 'received from Broker'

        if (body is not None):                                                                                                      # Valid body message type
        # Get mandatory body parameters
            try:    version         = body[self.getGvar('mqttBodyVersion')]
            except: allMandatoryPar = False                                                                                         # Missing mandatory body parameter

            try:    nodeId          = body[self.getGvar('mqttBodyNodeId')]
            except: allMandatoryPar = False                                                                                         # Missing mandatory body parameter

            try:    portId          = body[self.getGvar('mqttBodyPortId')]
            except: allMandatoryPar = False                                                                                         # Missing mandatory body parameter

            try:    respondTo       = body[self.getGvar('mqttBodyRespondTo')]
            except: allMandatoryPar = False                                                                                         # Missing mandatory body parameter

            try:    sessionId       = body[self.getGvar('mqttBodySessionId')]
            except: allMandatoryPar = False                                                                                         # Missing mandatory body parameter

            try:    desiredState    = body[self.getGvar('mqttBodyState')][self.getGvar('mqttBodyStateDesired')]
            except: allMandatoryPar = False                                                                                         # Missing mandatory body parameter

            if (allMandatoryPar and nodeId == self.getGvar('confRemoteControlId')):                                                 # All mandatory parameters in the body and correct sending node-id
                self.response = self.getGvar('messageResponse')
                self.fjbData['track']           = None                                                                              # For the response
                self.fjbData['portId']          = portId                                                                            # For the response
                self.fjbData['respondTo']       = respondTo                                                                         # For the response
                self.fjbData['sessionId']       = sessionId                                                                         # For the response
                self.fjbData['reportedState']   = reportedState                                                                     # For the response
                self.fjbData['identity']        = None                                                                              # For the response
                self.fjbData['desiredState']    = desiredState                                                                      # For the response
                self.fjbData['bodyType']        = mBodyType                                                                         # For the response
                for key in self.fjbData.keys():
                    if (key == 'metaData'): self.fjbData.pop(key)
                self.response['fjb'] = self.fjbData
                self.setGvar('messageResponse', self.response)

                if (float(version) == float(self.getGvar('mqttUsedBodyVersion'))):                                                  # Correct body version
                    if (self.getSensorState(self.getGvar('localOperated')) == INACTIVE):                                            # Remote control possible when the station is not localy served
                        if (cmdTopic+self.getGvar('mqttTypeRoute')+'/'+self.getGvar('nodeId') in topic):                            # Route body type
                            if (self.getGvar('mqttRequest') in topic and mBodyType == self.getGvar('mqttTypeRoute')):               # Request
                                if (debug):                                                                                         print '--Route:', portId, 'ordered to', desiredState

                                htvSource = self.findSensor('htv'+portId[0:portId.find(':')].upper())
                                htvDest   = self.findSensor('htv'+portId[portId.find(':')+1:].upper())
                                vtvSource = self.findSensor('vtv'+portId[0:portId.find(':')])
                                vtvDest   = self.findSensor('vtv'+portId[portId.find(':')+1:])
                                if (debug):                                                                                         print 'htvSource: ', htvSource, ',htvDest: ', htvDest, 'vtvSource: ', vtvSource, ',vtvDest: ', vtvDest

                                if (htvSource is not None and htvDest is not None):                                                 # Normal route entry:exit sensors found
                                    route = self.findSensor(htvSource+':'+htvDest)
                                    if (route is not None):                                                                         # Normal route found
                                        if (desiredState == self.getGvar('mqttRouteSet')):                                          # Set route
                                            if (self.getSensorState(route) == INACTIVE):                                            # if inactive
                                                self.toggleSensorState(htvSource)
                                                self.toggleSensorState(htvDest)

                                            reportedState = self.getGvar('mqttRouteSet')

                                        elif (desiredState == self.getGvar('mqttRouteClear')):                                      # Clear route
                                            if (self.getSensorState(route) == ACTIVE):                                              # if active
                                                self.toggleSensorState(htvSource)
                                                self.toggleSensorState(htvDest)

                                            reportedState = self.getGvar('mqttRouteClear')

                                        else:                                                                                       # Unknown desired state
                                            self.addMetaData("error", "Unknown desired state")

                                    if (debug):                                                                                     print '--HTV:', portId, htvSource, 'to', htvDest

                                elif (vtvSource is not None and vtvDest is not None):                                               # Shunting route entry:exit sensors found
                                    route = self.findSensor(vtvSource+':'+vtvDest)
                                    if (debug):                                                                                     print 'route: ', route

                                    if (route is not None):                                                                         # Shunting route found
                                        if (desiredState == self.getGvar('mqttRouteSet')):                                          # Set route
                                            if (self.getSensorState(route) == INACTIVE):                                            # if inactive
                                                self.toggleSensorState(vtvSource)
                                                self.toggleSensorState(vtvDest)

                                            reportedState = self.getGvar('mqttRouteSet')

                                        elif (desiredState == self.getGvar('mqttRouteClear')):                                      # Clear route
                                            if (self.getSensorState(route) == ACTIVE):                                              # if active
                                                self.toggleSensorState(vtvSource)
                                                self.toggleSensorState(vtvDest)

                                            reportedState = self.getGvar('mqttRouteClear')

                                        else:                                                                                       # Unknown desired state
                                            self.addMetaData("error", "Unknown desired state")

                                else:                                                                                               # Port-id not found
                                    self.addMetaData("error", "Port-id not found")

                                    if (debug):                                                                                     print '--VTV:', portId, vtvSource, 'to', vtvDest
                            else:                                                                                                   # wrong body type
                                self.addMetaData("error", "Wrong body type in the request")

                        elif (cmdTopic+self.getGvar('mqttTypeSwitch')+'/'+self.getGvar('nodeId') in topic):                         # Switch body type
                            if (self.getGvar('mqttRequest') in topic and mBodyType == self.getGvar('mqttTypeSwitch')):              # Request
                                if (debug):                                                                                         print '--Turnout:', portId, 'ordered to', desiredState

                                switch = self.findTurnout('Vx'+portId)
                                if (switch is not None):                                                                            # Turnout found
                                    if (desiredState == self.getGvar('mqttSwitchClosed')):
                                        if (self.getTurnoutState(switch) == THROWN):
                                            if (debug):                                                                             print '--Turnout:', portId, 'set to', desiredState

                                            if (self.toggleTurnoutState(switch)):                                                   # Change succesful
                                                if (self.getTurnoutState(switch) == CLOSED):
                                                    reportedState = self.getGvar('mqttSwitchClosed')

                                                elif (self.getTurnoutState(switch) == THROWN):
                                                    reportedState = self.getGvar('mqttSwitchThrown')

                                                else:
                                                    reportedState = self.getGvar('mqttSwitchInconsistent')

                                            else:                                                                                   # Change unsuccesful
                                                reportedState = self.getGvar('mqttSwitchThrown')

                                        else:                                                                                       # Turnout already closed
                                            reportedState = self.getGvar('mqttSwitchClosed')

                                    elif (desiredState == self.getGvar('mqttSwitchThrown')):
                                        if (self.getTurnoutState(switch) == CLOSED):
                                            if (debug):                                                                             print '--Turnout:', portId, 'set to', desiredState

                                            if (self.toggleTurnoutState(switch)):                                                   # Change succesful
                                                if (self.getTurnoutState(switch) == THROWN):
                                                    reportedState = self.getGvar('mqttSwitchThrown')

                                                elif (self.getTurnoutState(switch) == CLOSED):
                                                    reportedState = self.getGvar('mqttSwitchClosed')

                                                else:
                                                    reportedState = self.getGvar('mqttSwitchInconsistent')

                                            else:                                                                                   # Change unsuccesful
                                                reportedState = self.getGvar('mqttSwitchClosed')

                                        else:                                                                                       # Turnout already Thrown
                                            reportedState = self.getGvar('mqttSwitchThrown')

                                    else:                                                                                           # Unknown desired state
                                        self.addMetaData("error", "Unknown desired state")

                                    if (debug):                                                                                     print '--Turnout:', portId, 'reported to', reportedState

                                else:                                                                                               # Port-id not found
                                    self.addMetaData("error", "Port-id not found")

                            else:                                                                                                   # wrong body type
                                self.addMetaData("error", "Wrong body type in the request")

                    else:                                                                                                           # Station is localy served, remote control not allowed
                        self.addMetaData("error", "Remote control not allowed, station is localy served")
                        if (debug):                                                                                                 print 'Station is localy served, remote control not allowed'

                else:                                                                                                               # Unsupported body version
                    self.addMetaData("error", "Unsupported body version")
                    if (debug):                                                                                                     print 'Wrong version :', version, 'supported version <', self.getGvar('mqttBodyVersion')

            else:                                                                                                                   # The received body is missing mandatory parameters or Wrong sending node-id
                self.addMetaData("error", "Missing mandatory parameters or Wrong sending node-id")
                if (debug):                                                                                                         print 'Missing mandatory parameters or Wrong sending node-id'

        else:                                                                                                                       # The received body type is not supported
            self.addMetaData("error", "Unsupported body type")
            if (debug):                                                                                                             print 'Unsupported body type'


        if (debug):                                                                                                                 print '----------------- message Mqtt Remote control'; print ''
        self.updateMessageResponse('reportedState', reportedState)
        self.toggleSensorState(self.sendResponse)

        return

#----------------------------------------------------------------------------------------------------------------------------------------------------------------
# Do Subscribe for MQTT topics for Remote Control
#----------------------------------------------------------------------------------------------------------------------------------------------------------------
if (mqttAdapter):
    myMqtt      = myMqttListener()
    mqttCmd     = myMqtt.getGvar('mqttCmd')
    mqttScale   = myMqtt.getGvar('mqttScale')
    nodeId      = myMqtt.getGvar('nodeId')
    typeRoute   = myMqtt.getGvar('mqttTypeRoute')
    typeSwitch  = myMqtt.getGvar('mqttTypeSwitch')

    mqttAdapter.subscribe(mqttCmd+'/'+mqttScale+'/'+typeRoute+'/'+nodeId+'/#', myMqtt)                                               # Subscribe on route commands for own nodeId
    mqttAdapter.subscribe(mqttCmd+'/'+mqttScale+'/'+typeSwitch+'/'+nodeId+'/#', myMqtt)                                              # Subscribe on switch commands for own nodeId
