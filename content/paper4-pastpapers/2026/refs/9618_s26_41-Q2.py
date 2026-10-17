class ToyRecord:
    def __init__(self, ToyName="", NumberBricks=0, Difficulty="", Category=""):
        self.ToyName = ToyName  # string
        self.NumberBricks = NumberBricks  # integer
        self.Difficulty = Difficulty  # string
        self.Category = Category  # string

def ReadData(TheToys):
    try:
        with open("Toys.txt", encoding="utf-8") as f:
            for i, line in enumerate(f):
                Name, Bricks, Difficulty, Category = line.rstrip("\r\n").split(",")
                TheToys[i] = ToyRecord(Name, int(Bricks), Difficulty, Category)
    except OSError:
        print("Could not read toys")
    return TheToys

def OutputToys(TheToys):
    for Toy in TheToys:
        print(Toy.ToyName, Toy.NumberBricks, Toy.Difficulty, Toy.Category)

def SearchToys(TheToys):
    Choice = input("Difficulty: 1 Easy, 2 Medium, 3 Expert: ")
    Choices = {"1":"Easy", "2":"Medium", "3":"Expert", "easy":"Easy", "medium":"Medium", "expert":"Expert"}
    while Choice.lower() not in Choices:
        Choice = input("Difficulty: 1 Easy, 2 Medium, 3 Expert: ")
    Difficulty = Choices[Choice.lower()]
    return [Toy for Toy in TheToys if Toy.Difficulty == Difficulty]

def WriteToys(TheToys):
    with open("SelectedToys.txt", "w", encoding="utf-8") as f:
        for Toy in TheToys:
            f.write(f"{Toy.ToyName},{Toy.NumberBricks},{Toy.Difficulty},{Toy.Category}\n")

def main():
    TheToys = [None] * 16
    TheToys = ReadData(TheToys)
    OutputToys(TheToys)
    Selected = SearchToys(TheToys)
    WriteToys(Selected)
main()
