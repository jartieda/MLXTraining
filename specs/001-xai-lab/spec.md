# Feature Specification: Explainable AI Lab

**Feature Branch**: `001-xai-lab`

**Created**: 2026-08-17

**Status**: Draft — amended 2026-08-17 for constitution v3.1.0 (invitation-only accounts)

**Input**: User description: "A web app for the Technovation program where participants learn Explainable AI, in the spirit of Machine Learning for Kids and Teachable Machine. Learners capture images into several classes, fine-tune an image model on those captures, and test the model while seeing a heat map that explains the prediction. Accounts are created by invitation — an administrator invites educators, an educator invites her learners into a classroom — with a guided learning path and an educator dashboard. Training runs on the learner's own device."

## Clarifications

### Session 2026-08-17

- Q: When an administrator deactivates an educator who still owns a classroom with enrolled learners, what happens to that classroom? → A: The administrator reassigns it to another educator. She may see a classroom's name and current owner for that purpose, and nothing else about it.
- Q: Should the system keep an auditable record of privileged actions? → A: Only the irreversible ones — deleting a learner account, deactivating an educator, reassigning a classroom. Append-only, no personal data, and never exposed through a screen or export.
- Q: How much entropy must an invitation code have, and how many failed redemption attempts are tolerated? → A: 6 characters from a 32-symbol alphabet without ambiguous characters (~30 bits), 5 failed attempts per hour per origin, 72-hour validity. The rate limit is therefore load-bearing and needs its own test.
- Q: How does an educator's invitation code reach her, given that the application never sends email? → A: The lab opens the administrator's own mail client with recipient and message prefilled, with copy-to-clipboard as the fallback. The application itself sends nothing.
- Q: In what format does an educator export her classroom's progress summary? → A: A single CSV file, one row per learner and module, including a column holding that module's reflection answer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Teach a model and watch it work (Priority: P1)

A learner opens the lab, allows camera access, and creates two or more named classes such as "thumbs up" and "thumbs down". For each class she holds the pose in front of the camera and captures a burst of images, watching the count rise. When every class has samples she presses Train, sees a progress indication, and within seconds the lab switches to a live preview showing the predicted class and a confidence bar for every class, updating as she moves.

**Why this priority**: This is the entire product in miniature. Without it there is nothing to explain, no data for the lessons, and nothing for an educator to observe. It is also the moment that earns the learner's attention.

**Independent Test**: Fully testable on its own — capture, train, and predict with no account, no lessons, and no explanations. Delivers a working "teach the computer" experience comparable to existing tools.

**Acceptance Scenarios**:

1. **Given** a learner with a working camera and no prior project, **When** she creates two classes, captures at least five images in each, and presses Train, **Then** training completes and the live preview reports a predicted class with per-class confidence values that sum to 100%.
2. **Given** a trained model, **When** the learner presents an object matching one of the classes, **Then** that class is reported as the prediction with the highest confidence.
3. **Given** a class with zero captured samples, **When** the learner presses Train, **Then** the lab refuses to train and names the empty class in a message that says what to do next.
4. **Given** the learner denies camera permission, **When** the capture view loads, **Then** the lab explains that the camera is required, how to re-enable it, and offers file upload as an alternative way to add samples.

---

### User Story 2 - See where the model is looking (Priority: P2)

With a trained model, the learner freezes a frame and asks the lab to explain it. A coloured overlay appears on top of her captured image, warm where the evidence for the predicted class is concentrated and cool where it is not, with a legend showing the scale. She can switch the explanation to any other class and see where the evidence for that alternative would have been.

**Why this priority**: This is the feature that makes the product about explainable AI rather than about classification. It is the shortest path from "the computer guessed" to "the computer looked here".

**Independent Test**: Testable against any trained model from Story 1 by freezing a frame and requesting an explanation; delivers the core XAI insight without lessons, accounts, or a second method.

**Acceptance Scenarios**:

1. **Given** a trained model and a frozen frame, **When** the learner requests an explanation, **Then** a heat map is overlaid on the frozen frame with a legend, and the class being explained is named on screen.
2. **Given** a displayed explanation, **When** the learner selects a different class, **Then** the overlay updates to show the evidence for that class and the label changes accordingly.
3. **Given** a displayed explanation, **When** a screen reader is in use, **Then** a text description conveys where the strongest evidence falls, described in plain terms such as "strongest in the centre-left of the image".
4. **Given** a displayed explanation, **When** the learner adjusts the overlay strength, **Then** she can see the underlying image clearly at one end of the range and the heat map clearly at the other.

---

### User Story 3 - Compare two explanations (Priority: P3)

On the same frozen frame the learner views two explanations side by side. One is produced from the model's internal evidence, the other by covering small parts of the picture and watching how much the confidence drops. The lab reports how strongly the two agree and, when they disagree, prompts the learner to consider which one she trusts and why.

**Why this priority**: Teaches the deepest idea in the curriculum — that an explanation is itself a model with limitations. It requires Story 2 to exist first, which is why it sits below it.

**Independent Test**: Testable by generating both explanations for one frozen frame and confirming both render, an agreement figure is reported, and disagreement is surfaced rather than hidden.

**Acceptance Scenarios**:

1. **Given** a frozen frame with a prediction, **When** the learner opens the comparison view, **Then** both explanations render for the same class alongside an agreement score and a plain-language reading of that score.
2. **Given** the two explanations highlight different regions, **When** the comparison is shown, **Then** the lab states that they disagree and explains that neither is guaranteed correct.
3. **Given** the slower explanation method is running, **When** the learner waits, **Then** progress is shown and the interface stays responsive, and she can cancel.

---

### User Story 4 - Keep an account and come back to my work (Priority: P4)

A learner's educator hands her a username and a short invitation code. She enters both, chooses her own password and an alias, and the account is hers — the educator never sees that password. Her projects — class names, sample counts, trained models, and results — are still there when she returns on the same device. If she forgets her password, her educator issues a fresh code rather than emailing anyone.

**Why this priority**: Needed for lessons and the educator dashboard to mean anything, and for a multi-session classroom activity. Not needed for the core experience, so it sits after the explanation work.

**Independent Test**: Testable by redeeming an invitation, creating a project, logging out, logging back in, and confirming the project list and its contents are intact; and separately by attempting to redeem an expired, already-used, and revoked code.

**Acceptance Scenarios**:

1. **Given** a learner holding a valid username and invitation code, **When** she redeems it and chooses a password and an alias, **Then** her account becomes usable immediately and she sees an empty project list.
2. **Given** an invitation code that has expired, has already been redeemed, or has been revoked by the educator, **When** the learner attempts to redeem it, **Then** redemption is refused with a message that says which of the three applies and that she should ask her educator for a new code.
3. **Given** a learner who has forgotten her password, **When** her educator issues a fresh reset code, **Then** she can set a new password and regain access, and no email is sent to anyone.
4. **Given** a learner with an account, **When** her educator looks anywhere in the interface or in an export, **Then** the learner's password is not present or recoverable in any form.
5. **Given** a returning learner on the same device, **When** she logs in, **Then** her projects appear with their class names, sample counts, and trained-model status.
6. **Given** a learner who logs in on a different device, **When** she opens a project, **Then** the lab explains that samples and models stay on the device where they were created and offers to start a fresh copy.
7. **Given** an unauthenticated visitor, **When** she uses the lab without an account, **Then** the full capture-train-explain journey still works and the lab explains that nothing will be saved.
8. **Given** any learner's account, **When** her alias appears on a roster or in an export, **Then** neither her username nor any other identifier is present anywhere in that view or file.

---

### User Story 5 - Follow the guided path (Priority: P5)

A learner works through a sequence of modules. Each module states what she will learn, walks her through steps in the lab, sets a challenge, and asks a reflection question she answers in her own words. Her progress and answers are saved, and she can see how far she has come.

**Why this priority**: This is what turns a tool into a course and distinguishes the lab from a general-purpose model trainer. It depends on Stories 1–4 being in place to have anything to guide.

**Independent Test**: Testable by completing one module end to end — reading it, doing the lab steps, meeting the challenge, answering the reflection — and confirming progress persists.

**Acceptance Scenarios**:

1. **Given** a logged-in learner, **When** she opens the learning path, **Then** she sees the modules with her completion state for each.
2. **Given** an open module, **When** she completes a step, **Then** the step is marked done and her position is saved without her having to press save.
3. **Given** a reflection question, **When** she submits an answer, **Then** the answer is stored against that module and she can revisit and revise it.
4. **Given** a module with a challenge that depends on a trained model, **When** she has no trained model, **Then** the module tells her which earlier step to complete first.

---

### User Story 6 - Run a classroom (Priority: P6)

An educator creates a classroom and adds her group by issuing a username and an invitation code for each learner. She sees, for each learner, which modules are complete, the accuracy figures they recorded, and their reflection answers — and never their images. She can remove a learner, reset a learner's password, delete an account, and export a summary of the classroom's progress.

**Why this priority**: Makes the lab usable as a workshop rather than a solo toy, which is how the Technovation program actually runs. Depends on accounts and lessons existing.

**Independent Test**: Testable by creating a classroom, issuing an invitation, redeeming it as a second account, completing a module as that learner, and confirming it appears on the educator's view and that no image data is reachable.

**Acceptance Scenarios**:

1. **Given** an educator account, **When** she creates a classroom, **Then** she can name it, rename it, and archive it, and she can begin issuing learner invitations immediately.
2. **Given** a classroom, **When** the educator issues an invitation with a username, **Then** she receives a single-use code to hand over, and the pending invitation is listed with its state until it is redeemed, expires, or is revoked.
3. **Given** an enrolled learner who has completed modules, **When** the educator opens her row, **Then** module completion, recorded accuracy figures, and reflection answers are shown, and no captured image is available anywhere in the view.
4. **Given** an educator, **When** she attempts to view a classroom she does not own, **Then** access is refused.
5. **Given** a populated classroom, **When** the educator exports a summary, **Then** she receives a file containing progress and reflections for her classroom only, identifying learners by alias.
6. **Given** an enrolled learner, **When** the educator removes her from the classroom, **Then** the educator's visibility of her ends while the learner keeps her own account, projects, and reflections.
7. **Given** an enrolled learner, **When** the educator deletes her account, **Then** every remotely stored row belonging to that account is removed, and the learner is told that the samples and models on her own device remain hers to delete.

---

### User Story 7 - Judge whether the model is any good, and whether it is fair (Priority: P7)

After training, the learner sees how many samples each class has, how often the model confuses one class for another, and its accuracy per class. Where the numbers suggest a problem — one class with far fewer samples, or one class consistently mistaken for another — the lab says so in plain language and points her at the relevant lesson.

**Why this priority**: Supplies the evidence the bias and fairness modules argue from. Valuable but meaningless before there is a model and an explanation to interrogate.

**Independent Test**: Testable by training on a deliberately skewed set and confirming the per-class figures, the confusion breakdown, and the imbalance notice all appear and are correct.

**Acceptance Scenarios**:

1. **Given** a trained model, **When** the learner opens the results view, **Then** she sees per-class sample counts, per-class accuracy, and a confusion breakdown across all classes.
2. **Given** classes with markedly different sample counts, **When** training finishes, **Then** the lab reports the imbalance, explains what it may do to the predictions, and **still presents the trained model for testing**.
3. **Given** two runs of the same project, **When** the learner opens the comparison, **Then** she sees both runs' figures next to each other and which classes changed.
4. **Given** a trained model, **When** the learner exports it, **Then** she is told what the exported file contains before it is produced.

---

### User Story 8 - Do all of it on a phone (Priority: P8)

A learner with only a phone completes the whole journey in portrait orientation: captures with the front or rear camera, switches between them, trains, tests, and reads the heat map. Nothing is missing compared with the desktop experience.

**Why this priority**: For a large share of the intended audience the phone is the only device. Specified as its own story so that mobile viability is demonstrated and tested rather than assumed.

**Independent Test**: Testable by running the complete journey at a narrow portrait viewport on a touch device and confirming every capability of Stories 1, 2, 3 and 7 is reachable.

**Acceptance Scenarios**:

1. **Given** a phone in portrait orientation, **When** the learner opens the lab, **Then** the capture, training, and testing areas are all reachable by scrolling, with no horizontal scrolling and no clipped controls.
2. **Given** a device with more than one camera, **When** the learner switches camera, **Then** capture continues with the newly selected camera and previously captured samples are unaffected.
3. **Given** a phone, **When** the learner rotates the device mid-session, **Then** the layout adapts and no samples, models, or explanations are lost.
4. **Given** a touch-only device, **When** the learner captures samples, **Then** press-and-hold burst capture is available and every control has a comfortable touch target.

---

### User Story 9 - Administer the program (Priority: P9)

A program administrator signs in to a small administration area, invites an educator by email address, and receives a single-use code to pass on. She sees the list of educators with the state of each invitation, can revoke an invitation that has not yet been redeemed, and can deactivate an educator who has left the program — handing that educator's classrooms to someone else so no group is stranded. She sees classrooms only as a name and an owner. She sees no learner, no project, no figure, and no piece of work.

**Why this priority**: Last, because a pilot or a demonstration can run from a seeded educator account. This story is what makes the program operable by someone other than a developer, so it blocks public operation — but it blocks no earlier demo, and every other story is testable without it.

**Independent Test**: Testable by signing in as an administrator, inviting an educator, redeeming that invitation as her, revoking a second invitation before redemption, reassigning a classroom, deactivating an account, and confirming that no learner data is reachable from any administration screen.

**Acceptance Scenarios**:

1. **Given** an administrator, **When** she invites an educator by email address, **Then** she receives a single-use code to pass on and the invitation appears in the list as pending.
2. **Given** a pending invitation, **When** the educator redeems it and sets her own password, **Then** her account becomes usable and the invitation is shown as redeemed.
3. **Given** a pending invitation, **When** the administrator revokes it, **Then** a subsequent redemption attempt is refused and says so.
4. **Given** an active educator, **When** the administrator deactivates her, **Then** she can no longer sign in, while her classrooms and her learners' work are left untouched.
5. **Given** a classroom whose educator has been deactivated, **When** the administrator reassigns it to another educator, **Then** the new educator sees the full roster and its progress, and the classroom is no longer unreadable by anyone.
6. **Given** an administrator anywhere in the administration area, **When** she looks for a learner, a project, a progress figure, a reflection, a metric, or an image, **Then** none is present and no navigation leads to one — a classroom appears only as a name and an owning educator.
7. **Given** a single remaining administrator, **When** she attempts to deactivate her own account, **Then** the action is refused with an explanation, so the program cannot be locked out of itself.

---

### Edge Cases

- **Camera unavailable or denied**: no camera hardware, permission denied, or the camera is claimed by another application — the lab must explain the cause and offer file upload as an alternative sample source.
- **Insufficient classes**: fewer than two classes defined, or one class with no samples — training is refused with a message naming what is missing.
- **Storage exhausted**: the device refuses further writes mid-capture — the lab must warn before samples are lost, report how much room is left, and offer to remove a project.
- **Session interrupted during training**: the tab is closed, backgrounded, or reloaded mid-training — on return the lab must report that training did not finish and offer to restart it, never presenting a half-trained model as ready.
- **Hardware acceleration unavailable**: the lab must still work, warning that training and explanation will be slower rather than disabling them.
- **Offline with an expired session**: the learner must keep full access to locally stored projects and be told that progress will sync when she is back online.
- **Same account on two devices**: samples and models do not follow the account; the lab must state this plainly rather than presenting an empty project as corrupted.
- **Invitation code expired, already redeemed, or revoked**: redemption must be refused with a message distinguishing the three cases, and must never reveal whether a username exists.
- **Learner forgets her password and her educator is unavailable**: the lab must say plainly that only her educator can issue a new code, and the learner must keep unrestricted access to the local lab in the meantime.
- **Username already taken**: an educator issuing a username that exists must be told at once and asked for another, before any code is generated.
- **Two learners in one classroom choose the same alias**: the second must be asked to pick a different one, so a roster and an export are never ambiguous.
- **Educator deactivated while her classroom has enrolled learners**: her learners keep their accounts and their work, and only her access ends. The administrator must be able to reassign the classroom to another educator, so that no group of learners is left permanently unreadable by any adult.
- **Last administrator attempts to deactivate herself**: refused, so the program cannot be locked out of its own administration.
- **Learner's account deleted while she is using the lab**: she must be told on her next action, and her local samples and models must remain on her device — the application cannot reach them, which is the intended consequence of keeping images local.
- **Learner removed from a classroom**: her own projects and reflections remain hers and remain accessible; only the educator's visibility ends.
- **A reflection that looks like a spreadsheet formula**: a learner writes an answer beginning with `=`, `+`, `-`, or `@`, or containing commas, quotes, and line breaks. The export must preserve it as text and must not let it execute when an educator opens the file — untrusted text written by a child ends up in an adult's spreadsheet, so this is the one export path where the input is hostile by default.
- **Identical class names, or a class renamed after training**: names must stay unambiguous, and results must remain correctly attributed after a rename.
- **A class the model has never seen**: presented with an object matching no class, the model will still name one — the lab must make it possible for a learner to discover this, as it is a teaching point rather than a bug.

## Requirements *(mandatory)*

### Functional Requirements

**Capture**

- **FR-001**: Learners MUST be able to create, rename, reorder, and delete named classes, with a minimum of two classes required before training.
- **FR-002**: Learners MUST be able to capture samples from a live camera feed, both one at a time and as a continuous burst while a control is held.
- **FR-003**: Learners MUST be able to add samples by uploading image files, so that the lab is usable without a camera.
- **FR-004**: The lab MUST display a live count of samples per class and let learners review and delete individual samples.
- **FR-005**: The lab MUST let learners select among available cameras where more than one exists.

**Training**

- **FR-006**: The lab MUST train a classifier over the learner's captured samples entirely on the learner's device, with no sample data sent anywhere.
- **FR-007**: The lab MUST report training progress and completion, and MUST allow cancellation.
- **FR-008**: The lab MUST expose at most three learner-comprehensible training settings, each with a working default and a plain-language explanation of its effect.
- **FR-009**: The lab MUST permit training on imbalanced classes, warning about the imbalance without blocking it.
- **FR-010**: The lab MUST retain the results of previous training runs for the same project so two runs can be compared.

**Testing and explanation**

- **FR-011**: The lab MUST show a live prediction with a confidence value for every class.
- **FR-012**: Learners MUST be able to freeze a frame and retain it for explanation.
- **FR-013**: The lab MUST produce a heat-map explanation derived from the model's internal evidence for a chosen class.
- **FR-014**: The lab MUST produce a second, independent heat-map explanation by covering parts of the image and measuring the resulting change in confidence.
- **FR-015**: Learners MUST be able to view both explanations for the same frozen frame together, with a reported measure of how strongly they agree.
- **FR-016**: The lab MUST let learners explain any class, not only the predicted one.
- **FR-017**: Every heat map MUST be accompanied by a legend and by a text alternative describing where the strongest evidence falls.
- **FR-018**: The lab MUST NOT present an explanation as the reason for a decision, and MUST surface disagreement between the two methods rather than reconciling it.
- **FR-019**: Learners MUST be able to adjust the strength of the heat-map overlay.

**Results and fairness**

- **FR-020**: The lab MUST report per-class sample counts, per-class accuracy, and a confusion breakdown after training.
- **FR-021**: The lab MUST detect and report class imbalance, explaining its likely effect on predictions.
- **FR-022**: The lab MUST let learners export a trained model as a file, stating what the file contains before producing it.

**Accounts**

- **FR-023**: Visitors MUST be able to use the complete capture, train, test, and explain journey without an account, and MUST be told that nothing will be saved.
- **FR-024**: The lab MUST NOT expose any registration path that a visitor can complete without a valid invitation, for any role. There is no self-service sign-up.
- **FR-025**: Learners MUST be identified throughout the interface by a self-chosen alias. No view, roster, or export may reveal a username, a real name, or an email address to another learner.
- **FR-026**: An educator MUST be able to invite a learner into a classroom she owns by assigning a username, and the lab MUST generate a single-use invitation code for her to hand over, shown once and with a copy-to-clipboard affordance. A learner's code is handed over in person, so the lab MUST NOT offer to email it.
- **FR-027**: A learner MUST be able to redeem an invitation code by setting her own password and choosing her alias, and the lab MUST NOT allow her educator to view or recover that password.
- **FR-028**: Invitation and password-reset codes MUST be 6 characters drawn from a 32-symbol alphabet that excludes visually ambiguous characters, MUST expire 72 hours after they are issued, and MUST be refused when expired, already redeemed, or revoked, with a message that says which of the three applies. Redemption MUST be rate-limited to 5 failed attempts per hour per origin, enforced where a modified client cannot remove it, and a refusal MUST NOT reveal whether the target username exists.
- **FR-029**: The lab MUST NOT collect or store a learner's email address, date of birth, or real name.
- **FR-030**: An educator MUST be able to issue a single-use password-reset code for a learner in her classroom without any email exchange, and the lab MUST NOT send email to a learner under any circumstance.
- **FR-031**: The lab MUST restore a learner's project list, class names, sample counts, and trained-model status on the device where they were created.
- **FR-032**: The lab MUST state plainly, when a learner logs in on a device that holds none of her samples, that samples and models remain on the device where they were captured.
- **FR-051**: A username MUST be unique across the system, and an alias MUST be unique within a classroom, so that no roster or export is ambiguous.
- **FR-052**: An educator MUST be able to revoke an unredeemed invitation and to delete a learner's account, and deletion MUST remove every remotely stored row belonging to that account.

**Learning path**

- **FR-033**: The lab MUST present a sequence of modules covering, at minimum: what the model sees; reading a heat map; shortcuts and bias, where the model latches onto background, lighting, or an incidental cue rather than the subject; deliberately fooling the model; comparing two explanations; a fairness module built on the imbalance experiment; and a final challenge in which the learner presents her model and its explanation.
- **FR-034**: Each module MUST state its learning goal, guide the learner through concrete steps in the lab, set a challenge, and ask at least one reflection question answered in the learner's own words.
- **FR-035**: The lab MUST save module progress automatically and MUST let learners revisit and revise reflection answers.
- **FR-036**: The fairness module MUST guide the learner to train deliberately on imbalanced classes, observe the effect in the confusion breakdown and in the heat map, then rebalance and compare the two runs side by side.
- **FR-037**: A module MUST tell the learner which earlier step to complete when its challenge requires something she does not yet have.

**Classrooms**

- **FR-038**: Educators MUST be able to create a classroom, rename it, and archive it.
- **FR-039**: An educator MUST be able to manage her classroom's membership: a learner belongs to at most one classroom, and removing her ends the educator's visibility while leaving the learner's own account, projects, and reflections intact.
- **FR-040**: Educators MUST see, for each enrolled learner, module completion, recorded accuracy figures, and reflection answers.
- **FR-041**: The lab MUST NOT make any learner's captured images reachable by an educator, an administrator, or another learner, through any view or export.
- **FR-042**: An educator MUST NOT be able to read data belonging to a classroom she does not own, and a learner MUST NOT be able to read another learner's data.
- **FR-043**: Educators MUST be able to export a progress summary limited to their own classroom, as a single CSV file with one row per learner and module, identifying learners by alias and including a column holding that module's reflection answer. Reflection text MUST be quoted so that embedded commas, double quotes, and line breaks survive intact, and MUST be neutralised so that a leading `=`, `+`, `-`, or `@` cannot be interpreted as a formula by a spreadsheet application.

**Administration**

- **FR-053**: An administrator MUST be able to invite an educator by email address, and the lab MUST generate a single-use invitation code for her to pass on. The lab MUST offer to hand that code over by opening the administrator's own mail client with the recipient and message prefilled, and MUST offer copy-to-clipboard as a fallback where no mail client is available. The lab itself MUST NOT send email.
- **FR-054**: An administrator MUST be able to see the list of educators with the state of every invitation, revoke an unredeemed invitation, and deactivate an educator account without affecting that educator's classrooms or her learners' work.
- **FR-055**: An administrator MUST NOT be able to read any classroom content — no learner account, project, training run, progress record, reflection, metric, or image — through any view or export. She MAY read a classroom's name and its current owner, which is the least she needs to perform FR-057 and nothing more.
- **FR-056**: The lab MUST refuse to deactivate the last remaining administrator, and MUST expose no path by which an administrator account can be created from within the application.
- **FR-057**: An administrator MUST be able to reassign a classroom from one educator to another, so that deactivating an educator never leaves a group of learners unreadable by any adult. The receiving educator gains the same access she would have over a classroom she created herself.
- **FR-058**: The system MUST record an append-only audit entry for each irreversible privileged action — deleting a learner's account, deactivating an educator, and reassigning a classroom — noting who acted, which action it was, which object it affected, and when. Reversible routine actions such as issuing or revoking an invitation are not recorded. An audit entry MUST NOT contain personal data, and the lab MUST NOT expose audit entries through any screen or export.

**Cross-cutting**

- **FR-044**: The lab MUST offer its interface in English by default and in Spanish by selection, persisting the learner's choice, with no untranslated user-facing text in either language.
- **FR-045**: The lab MUST support the complete learner journey on a phone in portrait orientation, with no capability absent relative to a desktop browser.
- **FR-046**: The lab MUST meet WCAG 2.1 Level AA, including keyboard operation of capture, training, and explanation controls.
- **FR-047**: The lab MUST remain functional without hardware acceleration, degrading speed rather than removing capability.
- **FR-048**: The lab MUST keep captured images and trained models on the learner's device, transmitting them only through an action the learner initiates and that names the destination.
- **FR-049**: The lab MUST warn a learner before device storage is exhausted and MUST offer a way to reclaim room.
- **FR-050**: The lab MUST NOT present a model as ready when its training did not complete.

### Key Entities

- **Administrator**: An account that invites educators, deactivates them, and reassigns their classrooms. Of a classroom she sees a name and an owner; of a learner she sees nothing at all. The first administrator exists because the system was installed with her; the application provides no way to create another.
- **Educator**: An account, created by redeeming an administrator's invitation, that owns classrooms, invites learners into them, and can read the progress and reflections of those learners — never their images. Identified to learners by a display name, never by an email address.
- **Learner**: A participant, created by redeeming an educator's invitation. Identified by an educator-assigned username, which no other learner sees, and by a self-chosen alias, which is what everyone sees. Holds projects and learning-path progress; belongs to at most one classroom at a time. The application holds no personal data about her.
- **Audit Entry**: An append-only record of one irreversible privileged action — who acted, what they did, which object it affected, and when. Holds no personal data, and is reachable only by direct inspection of stored data, never through the application. It exists so that a school can be answered when it asks who removed a learner's work.
- **Invitation**: A single-use, expiring code issued by an administrator to an educator, or by an educator to a learner. Records who issued it, for which username or email address, when it expires, and whether it has been redeemed or revoked. A password reset is a fresh invitation of the same kind.
- **Classroom**: A named group owned by one educator, containing the learners she invited.
- **Project**: A learner's unit of work — a set of classes, their samples, and the training runs performed on them.
- **Class**: A named category within a project, holding samples. A project needs at least two.
- **Sample**: One captured or uploaded image belonging to exactly one class. Remains on the learner's device.
- **Training Run**: One completed training of a project, recording when it ran, per-class sample counts, per-class accuracy, and the confusion breakdown. Retained so runs can be compared.
- **Model**: The trained classifier produced by a training run, stored on the learner's device and optionally exportable as a file.
- **Explanation**: A heat map for one frozen frame, one class, and one method, together with the agreement measure when two methods are compared.
- **Module**: A unit of the learning path with a learning goal, steps, a challenge, and reflection questions.
- **Progress**: A learner's completion state for a module.
- **Reflection**: A learner's own written answer to a module's question, readable by her educator.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor reaches her own working prediction within 5 minutes of arriving, without instruction.
- **SC-002**: Training a project of 3 classes with 30 samples each completes within 30 seconds on the reference laptop and within 90 seconds on the reference phone.
- **SC-003**: The evidence-based heat map appears within 1 second of being requested on the reference laptop; the covering-based heat map completes within 5 seconds, showing progress throughout and remaining cancellable.
- **SC-004**: The complete journey — capture, train, test, explain — is usable at 360 px viewport width with no horizontal scrolling and no clipped controls.
- **SC-005**: The interface is complete in both English and Spanish, with zero untranslated user-facing strings in either.
- **SC-006**: 80% of learners correctly identify the deliberately induced background shortcut in the bias module, and 80% correctly describe the effect of class imbalance in the fairness module.
- **SC-007**: 90% of learners complete the first module without needing help from an educator.
- **SC-008**: The lab becomes usable within 3 seconds on the reference phone over a typical school connection; the heavier machine-learning components load only when first needed.
- **SC-009**: The primary journey passes an automated accessibility audit at WCAG 2.1 AA with zero violations, and is completable using only a keyboard.
- **SC-010**: No captured image or model file leaves the device in any flow other than an export the learner initiates — verified by inspecting all outbound traffic across the full journey.
- **SC-011**: An educator can read progress and reflections for every learner in her own classroom and for no learner outside it — verified by attempting cross-classroom and cross-learner access and observing refusal.
- **SC-012**: The lab remains functional on the reference Chromebook with hardware acceleration unavailable, completing the SC-002 training within 4 times the accelerated duration.
- **SC-013**: An educator with no prior setup creates a classroom and issues her first learner invitation within 3 minutes.
- **SC-014**: An unauthenticated visitor completes the entire local journey — capture, train, test, and both explanations — with zero rows written to remote storage on her behalf, verified by inspecting stored data after a full session.
- **SC-015**: Deleting a learner's account removes every remotely stored row belonging to it, verified by querying for residual data afterwards and finding none.
- **SC-016**: No view or export available to any user reveals a learner's username, a real name, or an educator's email address to a learner, verified by inspecting every such surface.
- **SC-017**: Nothing the system stores holds a learner's email address, date of birth, or real name — verified by inspecting the structure of everything it stores, not only its contents.
- **SC-018**: An administrator attempting to reach any learner account, project, training run, progress record, reflection, or metric is refused in every case — verified by attempting each access directly and observing refusal. Of a classroom she can read only its name and owning educator, and nothing that any learner produced.
- **SC-019**: Each of the three irreversible privileged actions leaves exactly one audit entry naming the actor, the action, the affected object, and the time — verified by performing each action and inspecting stored data. No audit entry contains personal data, and no screen or export reveals one.
- **SC-020**: A sixth failed redemption attempt from one origin within an hour is refused on rate-limit grounds — verified by making six attempts against a modified client that bypasses any interface-level throttle. No refusal in the sequence discloses whether a target username exists.
- **SC-021**: A classroom export opens in a spreadsheet application with one row per learner and module and its reflection text intact — verified with a reflection that contains a comma, a double quote, a line break, and a leading `=`, and confirming that every character survives and that no cell is interpreted as a formula.

## Assumptions

- **Audience**: Participants aged 12–18 in the Technovation program, working in a facilitated session or independently, with no prior machine-learning background. Educators are program mentors or classroom teachers, not specialists.
- **Language**: English is the default interface language and Spanish is the only additional language in this release. Further languages are out of scope but the interface is structured so that adding one requires no code change.
- **Reference devices**: Performance criteria are measured against three named devices rather than an adjective, so that a budget can be proved or disproved. **Reference laptop**: a 2021-or-later mainstream laptop with an integrated GPU, 8 GB RAM, on mains power. **Reference Chromebook**: an Intel Celeron N4020 with 4 GB RAM and no discrete GPU, standing in for the low-end school machine. **Reference phone**: a Snapdragon 695-class Android with 4 GB RAM from around 2022. Older browsers without the required capabilities are told so plainly rather than partially supported.
- **Scale**: Tens of classrooms and low thousands of learners. Concurrency is not a design driver, since the computation happens on learners' own devices.
- **Images stay local**: Samples and models are held in browser storage on the device where they were created and do not follow the account across devices. This is a deliberate privacy decision, not a limitation to be fixed later.
- **No sharing service**: Learners share their work for the final challenge by presenting it live or by exporting a file themselves. The lab provides no learner-to-learner sharing in this release.
- **Model quality**: The classifier is built on a general-purpose pretrained image model, so accuracy on everyday objects and gestures is expected to be good and accuracy on fine-grained or unusual subjects is expected to be poor. That gap is itself teaching material.
- **Lesson authoring**: Module content is authored and maintained by the project team as part of the application, not created by educators in this release.
- **One classroom per learner**: A learner belongs to at most one classroom at a time, which matches how the program runs and keeps the educator's visibility unambiguous.
- **Brand**: The interface follows the Technovation design system. Use of the Technovation logo and wordmark requires confirmation from the program before public release; colour and typography choices do not.
- **Accounts exist only by invitation**: An administrator invites educators; an educator invites her learners. Nobody can register unbidden. Codes are handed over by whatever channel already exists — in person in a classroom, or by the program's own correspondence for an educator — so the application never has to deliver one itself.
- **Invitation code strength is a deliberate tradeoff**: 6 characters over a 32-symbol unambiguous alphabet is about 30 bits, chosen so a code can be dictated aloud in a classroom or written on a board without transcription errors — which is why the alphabet excludes `O`/`0` and `I`/`1`/`l`. At that length the rate limit is load-bearing rather than a secondary defence: roughly 360 guesses are available across a code's 72-hour life against about a billion possibilities. It must therefore be enforced where a modified client cannot remove it, and it carries its own test (SC-020). The exposure if a guess ever succeeded is bounded to one learner account in one classroom, which holds no personal data and no images, and whose unexpected redemption is visible to its educator.
- **Learner identity holds no personal data**: A learner is a username and an alias. Because the authentication provider requires an address-shaped identifier, one is derived from the username in a domain that cannot receive mail; it is never displayed, never mailed, and is not a means of contact.
- **First administrator**: The first administrator account exists because the system was installed with it, not because anything in the application created it.
- **Data controller**: The school or program operating a classroom is the data controller for its learners and is responsible for obtaining whatever parental permission its jurisdiction requires, outside this application. The project's defensible position rests on collecting no learner personal data at all rather than on recording a consent decision it could not verify.
- **Deletion**: Remote data is deleted by the educator, for a learner, or by the administrator deactivating an educator. Locally stored samples and models are on the learner's own device and are removed by her, or by clearing browser storage — the lab cannot reach them remotely, which is the intended consequence of keeping images local.
