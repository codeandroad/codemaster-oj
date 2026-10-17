Stack = ["-1"] * 20
TopOfStack = -1

def Push(Data):
    global TopOfStack
    if TopOfStack == 19:
        return -1
    TopOfStack += 1
    Stack[TopOfStack] = Data
    return 1

def Pop():
    global TopOfStack
    if TopOfStack == -1:
        return "-1"
    Data = Stack[TopOfStack]
    TopOfStack -= 1
    return Data

def ReadData(FileName):
    try:
        with open(FileName, encoding="utf-8") as f:
            for line in f:
                if Push(line.rstrip("\r\n")) == -1:
                    print("Stack full")
    except OSError:
        print("Could not read file")

def Calculate():
    Total = int(Pop())
    while TopOfStack >= 0:
        Operator = Pop()
        Number = int(Pop())
        if Operator == "+": Total += Number
        elif Operator == "-": Total -= Number
        elif Operator == "*": Total *= Number
        elif Operator == "/": Total /= Number
        elif Operator == "^": Total **= Number
    return Total

FileName = input("Enter filename: ")
ReadData(FileName)
if TopOfStack >= 0:
    print(Calculate())
