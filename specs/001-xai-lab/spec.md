# Feature Specification: Explainable AI Lab

**Feature Branch**: `001-xai-lab`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "A web app for the Technovation program where participants learn Explainable AI, in the spirit of Machine Learning for Kids and Teachable Machine. Learners capture images into several classes, fine-tune an image model on those captures, and test the model while seeing a heat map that explains the prediction. Includes sign up and login, a guided learning path, and an educator dashboard. Training runs on the learner's own device."

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

A learner signs up herself with an email address, declares her date of birth, and chooses an alias. If she is below the digital-consent age her account starts pending: she can use the whole lab, but nothing is saved until a parent or guardian confirms consent by email. Once active, her projects — class names, sample counts, trained models, and results — are still there when she returns on the same device.

**Why this priority**: Needed for lessons and the educator dashboard to mean anything, and for a multi-session classroom activity. Not needed for the core experience, so it sits after the explanation work.

**Independent Test**: Testable by signing up, creating a project, logging out, logging back in, and confirming the project list and its contents are intact; and separately by signing up with an under-age date of birth and confirming the pending-account behaviour.

**Acceptance Scenarios**:

1. **Given** a new visitor of or above the digital-consent age, **When** she signs up and confirms her email, **Then** she is logged in as an active account and sees an empty project list.
2. **Given** a new visitor below the digital-consent age, **When** she completes sign-up, **Then** her account is pending, she is told plainly why nothing will be saved yet, and she is offered a way to send a consent request to a parent or guardian.
3. **Given** a pending account, **When** the learner uses the lab, **Then** capture, training, testing, and both explanations all work, and no project, progress, or reflection is stored remotely.
4. **Given** a pending account whose guardian confirms consent, **When** the learner next opens the lab, **Then** her account is active and her work begins being saved.
5. **Given** an active account whose guardian withdraws consent, **When** withdrawal is confirmed, **Then** all of that account's remotely stored data is deleted.
6. **Given** a returning learner on the same device, **When** she logs in, **Then** her projects appear with their class names, sample counts, and trained-model status.
7. **Given** a learner who logs in on a different device, **When** she opens a project, **Then** the lab explains that samples and models stay on the device where they were created and offers to start a fresh copy.
8. **Given** a learner who has forgotten her password, **When** she requests a reset, **Then** she can regain access without contacting anyone.
9. **Given** an unauthenticated visitor, **When** she uses the lab without signing up, **Then** the full capture-train-explain journey still works and the lab explains that nothing will be saved.
10. **Given** any learner's account, **When** her alias appears on a roster or in an export, **Then** neither her real name nor her email address is present anywhere in that view or file.

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

An educator creates a classroom and receives a join code to give her group. Learners join with the code. The educator sees, for each learner, which modules are complete, the accuracy figures they recorded, and their reflection answers — and never their images. She can export a summary of the classroom's progress.

**Why this priority**: Makes the lab usable as a workshop rather than a solo toy, which is how the Technovation program actually runs. Depends on accounts and lessons existing.

**Independent Test**: Testable by creating a classroom, joining it as a second account, completing a module as that learner, and confirming it appears on the educator's view and that no image data is reachable.

**Acceptance Scenarios**:

1. **Given** an educator account, **When** she creates a classroom, **Then** she receives a join code she can share, and can regenerate or retire it.
2. **Given** a valid join code, **When** a learner enters it, **Then** she is enrolled and appears on the educator's roster under her alias.
3. **Given** an enrolled learner who has completed modules, **When** the educator opens her row, **Then** module completion, recorded accuracy figures, and reflection answers are shown, and no captured image is available anywhere in the view.
4. **Given** an educator, **When** she attempts to view a classroom she does not own, **Then** access is refused.
5. **Given** a populated classroom, **When** the educator exports a summary, **Then** she receives a file containing progress and reflections for her classroom only.

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

### Edge Cases

- **Camera unavailable or denied**: no camera hardware, permission denied, or the camera is claimed by another application — the lab must explain the cause and offer file upload as an alternative sample source.
- **Insufficient classes**: fewer than two classes defined, or one class with no samples — training is refused with a message naming what is missing.
- **Storage exhausted**: the device refuses further writes mid-capture — the lab must warn before samples are lost, report how much room is left, and offer to remove a project.
- **Session interrupted during training**: the tab is closed, backgrounded, or reloaded mid-training — on return the lab must report that training did not finish and offer to restart it, never presenting a half-trained model as ready.
- **Hardware acceleration unavailable**: the lab must still work, warning that training and explanation will be slower rather than disabling them.
- **Offline with an expired session**: the learner must keep full access to locally stored projects and be told that progress will sync when she is back online.
- **Same account on two devices**: samples and models do not follow the account; the lab must state this plainly rather than presenting an empty project as corrupted.
- **Learner removed from a classroom**: her own projects and reflections remain hers and remain accessible; only the educator's visibility ends.
- **Consent never arrives**: a pending account whose guardian never confirms must keep working locally indefinitely rather than locking the learner out, and must not nag on every visit.
- **Guardian email is wrong or bounces**: the learner must be able to correct it and resend without starting sign-up again.
- **Consent withdrawn while enrolled in a classroom**: the enrolment and the educator's view of that learner must disappear along with her remote data.
- **Implausible or edited date of birth**: a declared date of birth that is impossible must be refused; the lab is not expected to verify a plausible one, and this limitation must be recorded rather than implied to be solved.
- **Pending account joins a classroom**: enrolment must be refused with an explanation, since a pending account persists nothing remotely.
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
- **FR-008**: The lab MUST expose, at most, a small number of learner-comprehensible training settings, each with a working default and a plain-language explanation of its effect.
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
- **FR-024**: Anyone MUST be able to create an account themselves with an email address and a password, choosing whether the account is a learner or an educator, and MUST be able to recover a forgotten password without human intervention.
- **FR-025**: Learners MUST be identified throughout the interface by a self-chosen alias. No view, roster, or export may reveal a real name or an email address to another user.
- **FR-026**: Sign-up MUST require a date-of-birth declaration before the account is created, and the declaration MUST be retained so that the consent state of every account is auditable.
- **FR-027**: An account declared to be below the applicable digital-consent age MUST be created in a pending state: the holder MUST retain the complete local lab experience of FR-001 to FR-022, and MUST NOT have anything persisted remotely — no projects, no progress, no reflections, no classroom enrolment — until consent is recorded.
- **FR-028**: A pending account MUST be able to send a consent request to a parent or guardian email address, and MUST become fully active once consent is confirmed through that address.
- **FR-029**: A parent or guardian MUST be able to withdraw consent, and withdrawal MUST delete all of that account's remotely stored data.
- **FR-030**: The lab MUST tell a pending account holder, plainly and without shaming her, why her work is not being saved and what needs to happen for it to be saved.
- **FR-031**: The lab MUST restore a learner's project list, class names, sample counts, and trained-model status on the device where they were created.
- **FR-032**: The lab MUST state plainly, when a learner logs in on a device that holds none of her samples, that samples and models remain on the device where they were captured.

**Learning path**

- **FR-033**: The lab MUST present a sequence of modules covering, at minimum: what the model sees; reading a heat map; shortcuts and bias, where the model latches onto background, lighting, or an incidental cue rather than the subject; deliberately fooling the model; comparing two explanations; a fairness module built on the imbalance experiment; and a final challenge in which the learner presents her model and its explanation.
- **FR-034**: Each module MUST state its learning goal, guide the learner through concrete steps in the lab, set a challenge, and ask at least one reflection question answered in the learner's own words.
- **FR-035**: The lab MUST save module progress automatically and MUST let learners revisit and revise reflection answers.
- **FR-036**: The fairness module MUST guide the learner to train deliberately on imbalanced classes, observe the effect in the confusion breakdown and in the heat map, then rebalance and compare the two runs side by side.
- **FR-037**: A module MUST tell the learner which earlier step to complete when its challenge requires something she does not yet have.

**Classrooms**

- **FR-038**: Educators MUST be able to create a classroom, obtain a join code, and regenerate or retire that code.
- **FR-039**: Learners MUST be able to join a classroom with a valid code, and MUST be able to leave it.
- **FR-040**: Educators MUST see, for each enrolled learner, module completion, recorded accuracy figures, and reflection answers.
- **FR-041**: The lab MUST NOT make any learner's captured images reachable by an educator or by another learner, through any view or export.
- **FR-042**: An educator MUST NOT be able to read data belonging to a classroom she does not own, and a learner MUST NOT be able to read another learner's data.
- **FR-043**: Educators MUST be able to export a progress summary limited to their own classroom.

**Cross-cutting**

- **FR-044**: The lab MUST offer its interface in English by default and in Spanish by selection, persisting the learner's choice, with no untranslated user-facing text in either language.
- **FR-045**: The lab MUST support the complete learner journey on a phone in portrait orientation, with no capability absent relative to a desktop browser.
- **FR-046**: The lab MUST meet WCAG 2.1 Level AA, including keyboard operation of capture, training, and explanation controls.
- **FR-047**: The lab MUST remain functional without hardware acceleration, degrading speed rather than removing capability.
- **FR-048**: The lab MUST keep captured images and trained models on the learner's device, transmitting them only through an action the learner initiates and that names the destination.
- **FR-049**: The lab MUST warn a learner before device storage is exhausted and MUST offer a way to reclaim room.
- **FR-050**: The lab MUST NOT present a model as ready when its training did not complete.

### Key Entities

- **Learner**: A participant, identified by an alias. Holds projects and learning-path progress; may belong to at most one classroom at a time. Carries a consent state — pending or active — derived from her declared date of birth.
- **Educator**: An account that owns classrooms and can read the progress and reflections of learners enrolled in them, never their images, names, or email addresses.
- **Consent Record**: The evidence that a parent or guardian authorised a learner's account — when it was requested, when it was confirmed, and whether it has since been withdrawn.
- **Classroom**: A named group with a join code, owned by one educator, enrolling many learners.
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
- **SC-002**: Training a project of 3 classes with 30 samples each completes within 30 seconds on a mid-range laptop and within 90 seconds on a mid-range phone.
- **SC-003**: The evidence-based heat map appears within 1 second of being requested; the covering-based heat map completes within 5 seconds, showing progress throughout and remaining cancellable.
- **SC-004**: The complete journey — capture, train, test, explain — is usable at 360 px viewport width with no horizontal scrolling and no clipped controls.
- **SC-005**: The interface is complete in both English and Spanish, with zero untranslated user-facing strings in either.
- **SC-006**: 80% of learners correctly identify the deliberately induced background shortcut in the bias module, and 80% correctly describe the effect of class imbalance in the fairness module.
- **SC-007**: 90% of learners complete the first module without needing help from an educator.
- **SC-008**: The lab becomes usable within 3 seconds on a mid-range phone over a typical school connection; the heavier machine-learning components load only when first needed.
- **SC-009**: The primary journey passes an automated accessibility audit at WCAG 2.1 AA with zero violations, and is completable using only a keyboard.
- **SC-010**: No captured image or model file leaves the device in any flow other than an export the learner initiates — verified by inspecting all outbound traffic across the full journey.
- **SC-011**: An educator can read progress and reflections for every learner in her own classroom and for no learner outside it — verified by attempting cross-classroom and cross-learner access and observing refusal.
- **SC-012**: The lab remains functional without hardware acceleration, completing the SC-002 training within 4 times the accelerated duration.
- **SC-013**: An educator with no prior setup creates a classroom and gets a working join code within 3 minutes.
- **SC-014**: A pending account can complete the entire local journey — capture, train, test, and both explanations — with zero rows written to remote storage on its behalf, verified by inspecting stored data after a full session.
- **SC-015**: Withdrawal of consent removes every remotely stored row belonging to that account, verified by querying for residual data afterwards and finding none.
- **SC-016**: No view or export available to an educator or another learner contains a real name or an email address, verified by inspecting every such surface.

## Assumptions

- **Audience**: Participants aged 12–18 in the Technovation program, working in a facilitated session or independently, with no prior machine-learning background. Educators are program mentors or classroom teachers, not specialists.
- **Language**: English is the default interface language and Spanish is the only additional language in this release. Further languages are out of scope but the interface is structured so that adding one requires no code change.
- **Devices**: A reasonably current browser with camera access, ranging from a low-end school Chromebook to a mid-range phone. Older browsers without the required capabilities are told so plainly rather than partially supported.
- **Scale**: Tens of classrooms and low thousands of learners. Concurrency is not a design driver, since the computation happens on learners' own devices.
- **Images stay local**: Samples and models are held in browser storage on the device where they were created and do not follow the account across devices. This is a deliberate privacy decision, not a limitation to be fixed later.
- **No sharing service**: Learners share their work for the final challenge by presenting it live or by exporting a file themselves. The lab provides no learner-to-learner sharing in this release.
- **Model quality**: The classifier is built on a general-purpose pretrained image model, so accuracy on everyday objects and gestures is expected to be good and accuracy on fine-grained or unusual subjects is expected to be poor. That gap is itself teaching material.
- **Lesson authoring**: Module content is authored and maintained by the project team as part of the application, not created by educators in this release.
- **One classroom per learner**: A learner belongs to at most one classroom at a time, which matches how the program runs and keeps the educator's visibility unambiguous.
- **Brand**: The interface follows the Technovation design system. Use of the Technovation logo and wordmark requires confirmation from the program before public release; colour and typography choices do not.
- **Accounts**: Anyone creates their own account with an email address; there is no educator-provisioned path in this release. An email address is the only personal datum collected, and it is used solely for authentication, password recovery, and the guardian consent exchange.
- **Age and consent**: A declared date of birth below the digital-consent age puts the account in a pending state until a guardian confirms consent by email. The digital-consent age is treated as a single configured value rather than resolved per jurisdiction in this release; the applicable threshold and the strength of the verification mechanism require legal review before public launch. The lab does not attempt to verify that a plausible declared date of birth is truthful.
- **Deletion**: Withdrawal of consent deletes remote data. Locally stored samples and models are on the learner's own device and are removed by her, or by clearing browser storage — the lab cannot reach them remotely, which is the intended consequence of keeping images local.
