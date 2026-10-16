# Gradient training with more passes and more train samples

The frozen recipe of `../recipe.ts` trains for 3 passes over 40,000 train samples, with settings that were tuned for JSON. Its row 9, the training and the count, is 5 points of all three below the search and below the table filled by hand-written rules (see `../runs/README.md`). This folder measures what the same gradient training reaches on the validation split when it gets more passes and more train samples.

**What these numbers are, and are not.** This study changes settings on purpose, and the settings were chosen with the scores of the validation split in view. So its numbers are not rows of the frozen recipe and not results on unseen data. Only the train and the validation split were read. No held-back set was read and no test split was scored.

**State at 16:14 on October 16:** the runs are going and no number is in this file yet. The trainings of 30 passes over 40,000 train samples (seeds 1, 2, 3), one training of 100 passes (seed 1) and the trainings of 3 passes over 400,000 train samples (seeds 1, 2, 3) were started. The logs are in `<scratch>/transfer/lr/runs/scale/logs/`.
