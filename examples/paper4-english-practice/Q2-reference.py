"""Runnable reference for Question 2 of 9618/41, May/June 2025."""


def ReadData():
    file_name = input("Enter file name: ")
    try:
        with open(file_name, "r", encoding="utf-8") as source:
            return [line.rstrip("\r\n") for line in source]
    except OSError:
        print("Could not read the file")
        return []


def StoreData(DataToStore, FileName):
    try:
        with open(FileName, "a", encoding="utf-8") as output:
            for item in DataToStore:
                output.write(str(item) + "\n")
    except OSError:
        print("Could not write the file")


def SplitData(DataArray):
    Red = []
    Green = []
    Blue = []
    Orange = []
    Yellow = []
    Pink = []

    for row in DataArray:
        value, colour = row.split(",")
        colour = colour.strip().lower()
        if colour == "red":
            Red.append(value)
        elif colour == "green":
            Green.append(value)
        elif colour == "blue":
            Blue.append(value)
        elif colour == "orange":
            Orange.append(value)
        elif colour == "yellow":
            Yellow.append(value)
        elif colour == "pink":
            Pink.append(value)

    StoreData(Red, "Red.txt")
    StoreData(Green, "Green.txt")
    StoreData(Blue, "Blue.txt")
    StoreData(Orange, "Orange.txt")
    StoreData(Yellow, "Yellow.txt")
    StoreData(Pink, "Pink.txt")


DataFromFile = ReadData()
SplitData(DataFromFile)
