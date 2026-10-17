class Character:
    def __init__(self, CharacterName, Colour, SuperStrength, Fly, Invisible):
        self.CharacterName = CharacterName  # string
        self.Colour = Colour  # string
        self.SuperStrength = SuperStrength  # string
        self.Fly = Fly  # string
        self.Invisible = Invisible  # string
    def GetCharacterName(self): return self.CharacterName
    def GetColour(self): return self.Colour
    def GetSuperStrength(self): return self.SuperStrength
    def GetFly(self): return self.Fly
    def GetInvisible(self): return self.Invisible

def ReadData():
    Characters = []
    try:
        with open("Characters.txt", encoding="utf-8") as f:
            for Line in f:
                Characters.append(Character(*Line.rstrip("\r\n").split(",")))
    except OSError:
        print("Could not read characters")
    return Characters

def OutputCharacters(Characters):
    for Item in Characters:
        print("Name:", Item.GetCharacterName(), "Colour:", Item.GetColour(), "Super strength:", Item.GetSuperStrength(), "Fly:", Item.GetFly(), "Invisible:", Item.GetInvisible())

def main():
    Characters = ReadData()
    OutputCharacters(Characters)
    # Two criteria, entered as characteristic=value, for example Colour=Black and Fly=Yes.
    First = input("First criterion (Colour/SuperStrength/Fly/Invisible=value): ")
    Second = input("Second criterion (a different characteristic=value): ")
    FirstField, FirstValue = First.split("=", 1)
    SecondField, SecondValue = Second.split("=", 1)
    Selected = []
    for Item in Characters:
        if getattr(Item, FirstField).lower() == FirstValue.lower() and getattr(Item, SecondField).lower() == SecondValue.lower():
            Selected.append(Item)
    print("Matching characters:", len(Selected))
    OutputCharacters(Selected)
main()
