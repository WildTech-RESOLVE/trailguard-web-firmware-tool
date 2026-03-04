(() => {
  const startScreen = document.getElementById("startScreen");
  const testScreen = document.getElementById("testScreen");
  const resultScreen = document.getElementById("resultScreen");

  const questionTitle = document.getElementById("questionTitle");
  const questionHint = document.getElementById("questionHint");
  const optionGrid = document.getElementById("optionGrid");

  const resultTitle = document.getElementById("resultTitle");
  const resultObserved = document.getElementById("resultObserved");
  const resultMeaning = document.getElementById("resultMeaning");
  const resultActions = document.getElementById("resultActions");
  const supportNote = document.getElementById("supportNote");
  const supportFormWrap = document.getElementById("supportFormWrap");
  const supportForm = document.getElementById("supportForm");
  const clientNameInput = document.getElementById("clientName");
  const clientOrganizationInput = document.getElementById("clientOrganization");
  const clientEmailInput = document.getElementById("clientEmail");
  const issueTitleInput = document.getElementById("issueTitle");
  const issueObservationInput = document.getElementById("issueObservation");
  const additionalInfoInput = document.getElementById("additionalInfo");
  const supportFormStatus = document.getElementById("supportFormStatus");

  const startTestBtn = document.getElementById("startTestBtn");
  const backBtn = document.getElementById("backBtn");
  const restartBtn = document.getElementById("restartBtn");
  const resultBackBtn = document.getElementById("resultBackBtn");
  const resultRestartBtn = document.getElementById("resultRestartBtn");
  const contactBtn = document.getElementById("contactBtn");
  const cancelSupportBtn = document.getElementById("cancelSupportBtn");
  const submitSupportBtn = document.getElementById("submitSupportBtn");

  const nodes = {
    magnetInSlot: {
      prompt: "Is the magnet currently in the slot?",
      hint: "Note: the magnet slot is located on the side of the camera and is used to enter set up mode. If you are testing normal operation, keep the magnet out of the slot.",
      options: [
        { id: "yes", label: "Yes", next: "setupPowerRed" },
        { id: "no", label: "No", next: "cameraLedPattern" }
      ]
    },
    setupPowerRed: {
      prompt: "Uncover and wave in front of the motion sensor to turn on the camera.",
      hint: "Check the Red Power Light on the Communications Unit.",
      options: [
        { id: "yes", label: "The Red Power Light is ON", next: "setupSigBoth" },
        { id: "no", label: "The Red Power Light is OFF", result: "likelyBatteryIssue" }
      ]
    },
    setupSigBoth: {
      prompt: "Check the Green Sig.1 and Green Sig.2 Lights on the Communications Unit.",
      options: [
        { id: "yes", label: "Sig.1 and Sig.2 Lights are both ON", result: "setupPortal" },
        { id: "sig1Only", label: "Sig.1 Light is ON, but Sig.2 Light is OFF", result: "couldNotTurnOnSetupMode" },
        { id: "no", label: "Sig.1 and Sig.2 Lights are both OFF", result: "ccuNotBootingFirmwareIssue" }
      ]
    },
    cameraLedPattern: {
      prompt: "Uncover and wave in front of the motion sensor to turn on the camera. Check the light on the side of the camera.",
      hint: "Choose the closest matching pattern after the trigger:",
      options: [
        {
          id: "persistentBlue",
          label: "Persistent Blue",
          next: "setupSigBoth"
        },
        {
          id: "oneBlueBlink",
          label: "One Blue Blink",
          result: "backgroundImageTrigger"
        },
        {
          id: "oneGreenBlink",
          label: "One Green Blink",
          next: "checkCcuPower"
        },
        {
          id: "didNotTurnOn",
          label: "The light did not turn ON",
          result: "likelyBatteryIssue"
        }
      ]
    },
    checkCcuPower: {
      prompt: "Check the Red Power Light on the Communications Unit.",
      options: [
        { id: "yes", label: "The Power Light is ON", next: "sig1Behavior" },
        { id: "no", label: "The Power Light is OFF", result: "likelyBatteryIssue" }
      ]
    },
    sig1Behavior: {
      prompt: "Check the Green Sig.1 Light on the Communications Unit.",
      options: [
        { id: "normal", label: "Sig.1 Light is ON", next: "orangeLedState" },
        { id: "off", label: "Sig.1 Light is OFF", result: "ccuNotBootingFirmwareIssue" },
        { id: "brief", label: "Sig.1 Light turns ON briefly, then OFF", result: "objectFilterLikely" }
      ]
    },
    orangeLedState: {
      prompt: "Check the Orange Signal Light on the Communications Unit.",
      hint: "Orange Signal Light typically turns on around 25 seconds after the Green Sig.1 Light turns ON.",
      options: [
        { id: "off", label: "Orange Signal Light did not turn ON", result: "simModuleNotReactive" },
        { id: "onNoBlink", label: "Orange Signal Light is ON, but not blinking", result: "simNotRegistering" },
        {
          id: "orangeBlinkSlow",
          label: "Orange Signal Light blinks slowly until unit turns off, but no image is seen on the dashboard",
          result: "slowNetworkLimited"
        },
        {
          id: "orangeBlinkTimeout",
          label: "Orange Signal Light blinks rapidly until unit turns off, but no image is seen on the dashboard",
          result: "networkTimeout"
        }
      ]
    }
  };

  const results = {
    setupPortal: {
      title: "You are in Set Up Mode",
      observed: "The magnet is in the side slot, Power, Sig.1 and Sig.2 lights are ON",
      meaning: "The unit is ready for Setup Mode portal operations.",
      actions: [
        "Join access point 'TrailGuard-XXXX' from your phone or laptop. Sig.2 light will blink when connected.",
        "Open 'http://192.168.1.1' in a browser to access the portal.",
        "Use the portal to run set up camera position, test network connectivity, and update firmware and settings."
      ]
    },
    likelyBatteryIssue: {
      title: "Battery or Power Path Issue",
      observed: "Power light is OFF when the unit is triggered.",
      meaning: "Battery may be low, faulty, or the power cable is not properly connected.",
      actions: [
        "Tightly secure the power cable to the Communications Unit.",
        "Charge or replace battery, then retry trigger and light checks."
      ]
    },
    couldNotTurnOnSetupMode: {
      title: "Could not enter Set Up Mode",
      observed: "The magnet is in the side slot, Power and Sig.1 lights are ON, but Sig.2 light is OFF.",
      meaning: "Set Up Mode did not fully initialize.",
      actions: [
        "Reinsert the magnet and ensure it is all the way in the slot. The device might be in an unstable state if the magnet is out of the slot when it is running",
        "Ensure the device is in an off state (all lights off, motion sensor covered) and turn the camera back on."
      ]
    },
    ccuNotBootingFirmwareIssue: {
      title: "Communications Unit Firmware Issue",
      observed: "Camera light is ON,Power light is ON, but Sig.1 and Sig.2 lights are OFF.",
      meaning: "Communications Unit firmware may be corrupted or not booting up correctly.",
      actions: [
        "Put the camera into Set Up Mode by inserting the magnet and triggering the unit on.",
        "Use the web firmware update tool and follow the instructions to install the latest firmware."
      ]
    },
    backgroundImageTrigger: {
      title: "Background Image Trigger",
      observed: "Camera blue light blinks once",
      meaning: "The trigger was classified as background image, so the Communications Unit did not wake up and transmit the image.",
      actions: [
        "Trigger again with object class of interest (human, animal, or vehicle) in the field of view."
      ]
    },
    objectFilterLikely: {
      title: "Object Class Filter may be blocking transmission",
      observed: "Camera green light blinks once, Sig. 1 light briefly turns on",
      meaning: "The trigger was classified as an object of interest, but an object class filter is in place. The image is saved to local storage but not transmitted to the cloud.",
      actions: [
        "Enter Setup Mode portal and review object filter settings.",
        "To test if the object class filter is the issue, temporarily disable filter and retest.",
      ]
    },
    simModuleNotReactive: {
      title: "Cellular Module Inactive",
      observed: "Sig. 1 light is ON, but Signal light does not light up.",
      meaning: "The Cellular Module within the Communications Unit was not properly initialized or powered up.",
      actions: [
        "Enter Set Up Mode by inserting the magnet and triggering the unit on.",
        "Join access point 'TrailGuard-XXXX' from your phone or laptop. Sig.2 light will blink when connected.",
        "Open 'http://192.168.1.1' in a browser to access the portal.",
        "Run Network Status Test under Device Tests/Cellular Module.",
      ]
    },
    simNotRegistering: {
      title: "Cellular Module could not register to a cellular network",
      observed: "Sig. 1 light is ON, Signal light is ON but does not blink.",
      meaning: "The captured image was sent to the Communications Unit for transmission, the cellular module is powered up but could not register to a cellular network within a reasonable time.",
      actions: [
        "Check that both antennas are tightly secured to the Communications Unit. Adjust the position and direction of the antennas to test for better signal reception",
        "Reseat the SIM card and verify active plan with your carrier.",
        "Enter the Set Up Mode Portal and run Network Status Test under Device Tests/Cellular Module. Run the test every 30 seconds until the signal light blinks."
      ]
    },
    slowNetworkLimited: {
      title: "Limited Network Speed (2G/3G)",
      observed: "Sig. 1 light is ON, Signal light blinks slowly, image upload unsuccessful after a few minutes.",
      meaning: "Network registration exists, but network speed is limited. The device timed out before the image could be uploaded.",
      actions: [
        "Check that both antennas are tightly secured to the Communications Unit. Adjust the position and direction of the antennas to test for better signal reception",
        "Try a different SIM card (4G or LTE) or carrier.",
        "Enter the Set Up Mode Portal and run Network Status Test under Device Tests/Cellular Module to verify carrier registration, signal strength, and network type."
      ]
    },
    networkTimeout: {
      title: "Limited Network Speed (4G) or Server Connection Issue",
      observed: "Sig. 1 light is ON, Signal light blinks rapidly, image upload unsuccessful after a few minutes.",
      meaning: "Network registration exists, 4G or LTE network is available, but the device timed out before the image could be uploaded. The server connection may be slow or unstable.",
      actions: [
        "Check that both antennas are tightly secured to the Communications Unit. Adjust the position and direction of the antennas to test for better signal reception",
        "Enter the Set Up Mode Portal and run Network Status Test under Device Tests/Cellular Module to verify carrier registration, signal strength, and network type.",
        "If the issue persists after verifying the network registration, please contact support to confirm server status."
      ],
    }
  };

  let currentNodeId = null;
  let currentResultId = null;
  const history = [];

  function startDiagnosis() {
    history.length = 0;
    currentResultId = null;
    showOnly("test");
    renderQuestion("magnetInSlot");
  }

  function restartDiagnosis() {
    history.length = 0;
    currentNodeId = null;
    currentResultId = null;
    resetSupportForm();
    showOnly("start");
    updateNavButtons();
  }

  function goBackOneStep() {
    if (history.length === 0) {
      return;
    }
    const last = history.pop();
    showOnly("test");
    renderQuestion(last.nodeId);
  }

  function renderQuestion(nodeId) {
    const node = nodes[nodeId];
    if (!node) {
      return;
    }
    currentNodeId = nodeId;
    currentResultId = null;

    questionTitle.textContent = node.prompt;
    questionHint.textContent = node.hint || "";
    optionGrid.innerHTML = "";

    node.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn option-btn";
      button.textContent = option.label;
      button.addEventListener("click", () => handleAnswer(nodeId, option));
      optionGrid.appendChild(button);
    });

    updateNavButtons();
  }

  function handleAnswer(nodeId, option) {
    const node = nodes[nodeId];
    if (!node) {
      return;
    }

    history.push({
      nodeId,
      question: node.prompt,
      answerId: option.id,
      answerLabel: option.label,
      note: option.note || ""
    });

    if (option.result) {
      renderResult(option.result);
      return;
    }

    if (option.next) {
      renderQuestion(option.next);
    }
  }

  function renderResult(resultId) {
    const result = results[resultId];
    if (!result) {
      return;
    }
    currentResultId = resultId;

    resultTitle.textContent = result.title;
    resultObserved.textContent = result.observed;
    resultMeaning.textContent = result.meaning;

    resultActions.innerHTML = "";
    result.actions.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      resultActions.appendChild(li);
    });

    supportNote.textContent = "If the issue persist, please contact support for further assistance.";
    resetSupportForm();

    showOnly("result");
    updateNavButtons();
  }

  function showOnly(screen) {
    startScreen.classList.toggle("hidden", screen !== "start");
    testScreen.classList.toggle("hidden", screen !== "test");
    resultScreen.classList.toggle("hidden", screen !== "result");
  }

  function updateNavButtons() {
    const disabled = history.length === 0;
    backBtn.disabled = disabled;
    resultBackBtn.disabled = disabled;
  }

  function openSupportForm() {
    if (!currentResultId) {
      return;
    }
    const result = results[currentResultId];
    if (!result) {
      return;
    }
    issueTitleInput.value = result.title;
    issueObservationInput.value = result.observed;
    supportFormWrap.classList.remove("hidden");
    supportFormStatus.textContent = "";
    clientNameInput.focus();
  }

  function closeSupportForm() {
    supportFormWrap.classList.add("hidden");
    supportFormStatus.textContent = "";
  }

  function resetSupportForm() {
    supportForm.reset();
    closeSupportForm();
    submitSupportBtn.disabled = false;
  }

  async function submitSupportRequest(event) {
    event.preventDefault();

    if (!currentResultId) {
      return;
    }
    if (!supportForm.reportValidity()) {
      return;
    }

    const result = results[currentResultId];
    if (!result) {
      return;
    }

    const formData = new FormData(supportForm);

    try {
      submitSupportBtn.disabled = true;
      supportFormStatus.textContent = "Submitting support request...";

      const response = await fetch(supportForm.action, {
        method: supportForm.method || "POST",
        body: formData
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        const message = data && data.message ? data.message : `HTTP ${response.status}`;
        throw new Error(message);
      }

      supportFormStatus.textContent = "Support request submitted successfully.";
      submitSupportBtn.disabled = false;
    } catch (error) {
      supportFormStatus.textContent = `Submission failed: ${error.message}. Please try again.`;
      submitSupportBtn.disabled = false;
    }
  }

  startTestBtn.addEventListener("click", startDiagnosis);
  backBtn.addEventListener("click", goBackOneStep);
  restartBtn.addEventListener("click", restartDiagnosis);
  resultBackBtn.addEventListener("click", goBackOneStep);
  resultRestartBtn.addEventListener("click", restartDiagnosis);
  contactBtn.addEventListener("click", openSupportForm);
  cancelSupportBtn.addEventListener("click", closeSupportForm);
  supportForm.addEventListener("submit", submitSupportRequest);

  restartDiagnosis();
})();
