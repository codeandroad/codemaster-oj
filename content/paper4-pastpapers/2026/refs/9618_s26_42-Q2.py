class Avatar:
    def __init__(self, TheName, Glasses, Hair, Age):
        self.__TheName = TheName  # string
        self.__Glasses = Glasses  # Boolean
        self.__Hair = Hair  # string
        self.__Age = Age  # integer
    def GetName(self): return self.__TheName
    def GetAge(self): return self.__Age
    def MeetCriteria(self, Glasses, Hair): return self.__Glasses == Glasses and self.__Hair == Hair

AvailableAvatars = []
MatchingAvatars = []

def LoadAvatars():
    global AvailableAvatars
    AvailableAvatars = []
    try:
        with open("AvatarFile.txt", encoding="utf-8") as f:
            for line in f:
                Name, Glasses, Hair, Age = line.split()
                AvailableAvatars.append(Avatar(Name, Glasses == "True", Hair, int(Age)))
    except OSError:
        print("Could not read avatars")

def EnterChoices():
    global MatchingAvatars
    Choice = input("Wear glasses? yes/no: ")
    while Choice not in ["yes", "no"]: Choice = input("Wear glasses? yes/no: ")
    Hair = input("Hair colour: ")
    while Hair not in ["black", "blonde", "brown", "pink", "red", "green"]: Hair = input("Hair colour: ")
    MatchingAvatars = []
    for Item in AvailableAvatars:
        if Item.MeetCriteria(Choice == "yes", Hair): MatchingAvatars.append(Item)

LoadAvatars()
EnterChoices()
print("Matching avatars:", len(MatchingAvatars))
for Item in MatchingAvatars: print("Name:", Item.GetName(), "Age:", Item.GetAge())
