import os,pty,select,sys,json,base64,tty
master,slave=pty.openpty();tty.setraw(slave)
print(json.dumps({'device':os.ttyname(slave)}),flush=True)
while True:
    readable,_,_=select.select([0,master],[],[],1)
    if 0 in readable:
        line=sys.stdin.readline()
        if not line:break
        command=json.loads(line)
        os.write(master,base64.b64decode(command['bytes']))
    if master in readable:
        data=os.read(master,4096)
        if not data:break
        print(json.dumps({'bytes':base64.b64encode(data).decode()}),flush=True)
