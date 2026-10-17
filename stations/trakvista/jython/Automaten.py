#
# Script contain two classes:
# TrainAutomation       class handles train meetings and train passings
#
# Written by Benny Tjäder 2024
#
# Train automatic handling works only when station is not local operated
#
# Automaten.py
#
import jmri

debug = True        # debug text is written in the console

#----------------------------------------------------------------------------------------------------------------------------------------------------------------
# Automatic handling of the train meetings and train passings
#----------------------------------------------------------------------------------------------------------------------------------------------------------------
class TrainAutomation(jmri.jmrit.automat.AbstractAutomaton):

    activeLoopTime      = 5000  #ms
    inActiveLoopTime    = 30000 #ms
    tamRetry            = 5000  #ms                                                                                                  # Re-try time when no accept received
    sensorToggleDelay   = 1000  #ms
    htvDelay            = 2000  #ms
    loopTime            = inActiveLoopTime                                                                                           # Time before checking again
    response            = {}
    exitData            = {}
    trainTypes          = {}

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Initialization
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def init(self):
        print 'Automaten started with', self.loopTime/1000, 'seconds loop time and', self.tamRetry/1000, 'seconds TAM retry'
        self.autoMeetings = 'AutomatiskaMoten'
        self.autoPassings = 'AutomatiskaPasseringar'
        self.localOperated = self.getGvar('localOperated')
        self.automaten = [sensors.provideSensor(self.autoMeetings), sensors.provideSensor(self.autoPassings)]
#                                       Möte    Passering
        self.trainTypes = {'Pt' : ['p', True,   True],
                           'Snt': ['p', False,  True],
                           'Gxt': ['g', False,  False],
                           'Gt' : ['g', False,  False],
                           'Lgt': ['g', True,   False],
                           'Tjt': ['x', True,   False]}
#                          "191",     "2",       "cda",    "got",  "TRUE",       "TRUE",        "Pt",     "Dagl",   "08:50",     "08:55",        "blabla"
        self.column     = {'Train':0, 'Track':1, 'From':2, 'To':3, 'Stopping':4, 'GoingThru':5, 'Type':6, 'Days':7, 'Arrivel':8, 'Departure':9, 'Note':10}
        self.table      = jmri.InstanceManager.getDefault(jmri.jmrit.logixng.NamedTableManager)
        self.tableName  = 'timetable'
        self.waitSensorActive(self.automaten)
        return
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Handling of the automatic service
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def handle(self):
        if (debug):                                                                                                                 print 'in the handle loop with looptime', self.loopTime/1000, 'seconds'
        self.waitMsec(self.loopTime)
        if (self.getSensorState(self.autoMeetings) == ACTIVE and self.getSensorState(self.autoPassings) == INACTIVE and
            self.getSensorState(self.localOperated) == INACTIVE):                                                                   # Automatic meetings active
            self.loopTime = self.activeLoopTime                                                                                     # Automatic is active set loop time to active value

            for m in self.getGvar('confModuleConnections'):
                tamRequest  = self.getGvar('confModuleObjects')[m]['tamRequest']
                tamBusy     = self.getGvar('confModuleObjects')[m]['tamBusy']
                tamAccept   = self.getGvar('confModuleObjects')[m]['tamAccept']
                tamReject   = self.getGvar('confModuleObjects')[m]['tamReject']

                if (self.getSensorState(tamRequest) == ACTIVE and self.getSensorState(tamBusy) == ACTIVE and
                    (self.getSensorState(tamAccept) == INACTIVE or self.getSensorState(tamReject) == INACTIVE)):                    # Ongoing TAM request

                    self.response = self.getGvar('messageResponse')
                    for x in self.response[m]: self.exitData[x] = self.response[m][x]

                    trackNo     = self.getTableCol(self.exitData['identity'], self.column['Track'])
                    if (trackNo and trackNo == '1'): track = 'htvI'                                                                 # Track 1 used
                    elif (trackNo and trackNo == '2'): track = 'htvII'                                                              # Track 2 used
                    else: track = 'htvIII'                                                                                          # Track 3 used

                    htvSource   = self.findSensor('htv'+m)
                    htvDest     = self.findSensor(track)
                    if (debug):                                                                                                     print 'TAM ongoing from exit', m

                    if (htvSource is not None and htvDest is not None):                                                             # Set selected track for incomming train
                        route   = self.findSensor(htvSource+':'+htvDest)

                        for mc in self.getGvar('confModuleConnections'):                                                            # Check that no active route exists to selected track
                            htvTest     = self.findSensor('htv'+mc)
                            testRoute   = self.findSensor(htvTest+':'+htvDest)
                            if (self.getSensorState(testRoute) == ACTIVE):                                                          # Active route exists so reject incoming TAM
                                reportedState = self.getGvar('mqttTamRejected')
                                self.updateMessageResponse('reportedState', reportedState, m)
                                self.setSensorState(tamReject, ACTIVE)
                                if (debug):                                                                                         print 'Active route exists from', mc, 'to', trackNo
                            else:
                                if (debug):                                                                                         print 'No active route from', mc, 'to', trackNo

                        if (self.getSensorState(route) == INACTIVE and (self.getSensorState(tamAccept) == INACTIVE or
                            self.getSensorState(tamReject) == INACTIVE)):                                                           # No active route to track exists so accept incoming TAM

#                            track = self.getTableCol(self.exitData['identity'], self.column['Track'])

                            self.setSensorState(htvSource, ACTIVE)
                            self.setSensorState(htvDest, ACTIVE)
                            self.waitMsec(self.htvDelay)
                            if (debug):                                                                                             print 'No existing route from', m, 'to', trackNo

                            if (self.getSensorState(route) == ACTIVE):                                                              # Route to track set
                                self.setSensorState(tamAccept, ACTIVE)
                                if (debug):                                                                                         print 'Route set from', m, 'to', trackNo

                            else:                                                                                                   # Route to track failed
                                reportedState = self.getGvar('mqttTamRejected')
                                self.updateMessageResponse('reportedState', reportedState, m)
                                self.setSensorState(tamReject, ACTIVE)
                                if (debug):                                                                                         print 'Route failed from', m, 'to', trackNo


        elif (self.getSensorState(self.autoMeetings) == INACTIVE and self.getSensorState(self.autoPassings) == ACTIVE and
              self.getSensorState(self.localOperated) == INACTIVE):                                                                 # Automatic passings active
            self.loopTime = self.activeLoopTime                                                                                     # Automatic is active set loop time to active value

            for m in self.getGvar('confModuleConnections'):
                tamRequest  = self.getGvar('confModuleObjects')[m]['tamRequest']
                tamBusy     = self.getGvar('confModuleObjects')[m]['tamBusy']
                tamAccept   = self.getGvar('confModuleObjects')[m]['tamAccept']
                tamReject   = self.getGvar('confModuleObjects')[m]['tamReject']

        elif (self.getSensorState(self.autoMeetings) == ACTIVE and self.getSensorState(self.autoPassings) == ACTIVE and
              self.getSensorState(self.localOperated) == INACTIVE):                                                                 # Automatic mettings and passings active
            self.loopTime = self.activeLoopTime                                                                                     # Automatic is active set loop time to active value

            for m in self.getGvar('confModuleConnections'):
                tamRequest  = self.getGvar('confModuleObjects')[m]['tamRequest']
                tamBusy     = self.getGvar('confModuleObjects')[m]['tamBusy']
                tamAccept   = self.getGvar('confModuleObjects')[m]['tamAccept']
                tamReject   = self.getGvar('confModuleObjects')[m]['tamReject']

        else:
            self.loopTime = self.inActiveLoopTime                                                                                   # Automatic is inactive set loop time to inactive value

        return True                                                                                                                 # to loop again

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Fetch sensor state
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getSensorState(self, s):
        return sensors.getSensor(s).getKnownState()

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Fetch time table columndata
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getTableCol(self, t, c):
        col = False
        for p in self.table.getNamedBeanSet(): 
            if (p.getUserName() == self.tableName):
                try: r = p.getRowNumber(t)
                except: r = False
                if (r): col = p.getCell(r,c)
        return col
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
            self.waitMsec(self.sensorToggleDelay)                                                                                   # Wait some seconds before response
            if (sensors.getSensor(s).getKnownState() == INACTIVE): res = True
            else: res = False

        elif (sensors.getSensor(s).getKnownState() == INACTIVE):
            sensors.getSensor(s).setKnownState(ACTIVE)
            self.waitMsec(self.sensorToggleDelay)                                                                                   # Wait some seconds before response
            if (sensors.getSensor(s).getKnownState() == ACTIVE): res = True
            else: res = False
        return res

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Get Global varible, returns None if not found
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def getGvar(self, v):
        globalVariables     = jmri.InstanceManager.getDefault(jmri.jmrit.logixng.GlobalVariableManager)
        try:    val         = globalVariables.getGlobalVariable(v).getValue()
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
    # Convert unicode to string for swedish characters
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def fromUni2Str(self, s):
#        svenska = {u'\u00C4': 'A', u'\u00C5': 'A', u'\u00D6': 'O', u'\u00E4': 'a', u'\u00E5': 'a', u'\u00F6': 'o'}
#        return str.translate(svenska)
        s = s.replace(u'\u00C4', 'A')   # Ä
        s = s.replace(u'\u00C5', 'A')   # Å
        s = s.replace(u'\u00D6', 'O')   # Ö
        s = s.replace(u'\u00E4', 'a')   # ä
        s = s.replace(u'\u00E5', 'a')   # å
        s = s.replace(u'\u00F6', 'o')   # ö
        return s

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Convert string to unicode for swedish characters
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def fromStr2Uni(self, s):
#        svenska = {'Ä': u'\xc4', 'Å': u'\xc5', 'Ö': u'\xd6', 'ä': u'\xe4', 'å': u'\xe5', 'ö': u'\xf6'}
#        return str.translate(svenska)
        s = s.replace('Ä', u'\u00C4')   # Ä
        s = s.replace('Å', u'\u00C5')   # Å
        s = s.replace('Ö', u'\u00D6')   # Ö
        s = s.replace('ä', u'\u00E4')   # ä
        s = s.replace('å', u'\u00E5')   # å
        s = s.replace('ö', u'\u00F6')   # ö
        return s

    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    # Update reported state the message response
    #----------------------------------------------------------------------------------------------------------------------------------------------------------------
    def updateMessageResponse(self, key, val, exit):
        self.exitData.update({key: val})
        self.response[exit] = self.exitData
        self.setGvar('messageResponse', self.response)
        return

#-----------------------------------------------------------------------
# Start the TrainAutomation
#-----------------------------------------------------------------------
a = TrainAutomation()
a.setName("Stationsautomaten")
a.start()
