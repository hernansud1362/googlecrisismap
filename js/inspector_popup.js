// Copyright 2012 Google Inc.  All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License.  You may obtain a copy
// of the License at: http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software distrib-
// uted under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES
// OR CONDITIONS OF ANY KIND, either express or implied.  See the License for
// specific language governing permissions and limitations under the License.

/**
 * @fileoverview [MODULE: edit] A table-driven property inspector enclosed
 *   in a popup.  Handles maps, layers, and topics.
 * @author kpy@google.com (Ka-Ping Yee)
 */
goog.provide('cm.InspectorPopup');

goog.require('cm.InspectorView');
goog.require('cm.LayerModel');
goog.require('cm.TopicModel');
goog.require('cm.css');
goog.require('cm.events');
goog.require('cm.ui');
goog.require('goog.dom.classes');
goog.require('goog.ui.Tooltip');

/**
 * A property inspector.  Call inspect() to inspect an object's properties.
 * @constructor
 */
cm.InspectorPopup = function() {
  /**
   * @type Element
   * @private
   */
  this.popup_;

  /**
   * @type Element
   * @private
   */
  this.titleElem_;

  /**
   * @type Element
   * @private
   */
  this.copyLayerLink_;

  /**
   * Listener token for the window's 'resize' event.
   * @type {cm.events.ListenerToken}
   * @private
   */
  this.windowResizeListener_;

  /**
   * @type Element
   * @private
   */
  this.okBtn_;

  /**
   * @type Element
   * @private
   */
  this.cancelBtn_;

  /**
   * Whether or not this dialog is for a newly created layer.
   * @type {boolean}
   * @private
   */
  this.isNewLayer_;

  /**
   * Whether or not this dialog is for a newly created topic.
   * @type {boolean}
   * @private
   */
  this.isNewTopic_;

  var tableElem;
  this.popup_ = cm.ui.create('div', {'class': [cm.css.INSPECTOR, cm.css.POPUP]},
      cm.ui.create('div', undefined,
          this.titleElem_ = cm.ui.create('h2'),
          this.copyLayerLink_ = cm.ui.createLink(cm.MSG_IMPORT_LAYERS)),
      tableElem = cm.ui.create('table',
          {'class': cm.css.EDITORS, 'cellpadding': '0', 'cellspacing': '0'}),
      cm.ui.create('div', {'class': cm.css.BUTTON_AREA},
          this.okBtn_ = cm.ui.create(
              'div', {'class': [cm.css.BUTTON, cm.css.SUBMIT]}, cm.MSG_OK),
          this.cancelBtn_ = cm.ui.create(
              'div', {'class': cm.css.BUTTON}, cm.MSG_CANCEL)));

  this.inspector_ = new cm.InspectorView(tableElem);

  cm.events.listen(this.copyLayerLink_, 'click', this.handleCopyClick_, this);
  cm.events.listen(this.okBtn_, 'click', this.handleOk_, this);
  cm.events.listen(this.cancelBtn_, 'click', this.handleCancel_, this);
};

/**
 * Fraction of the window size that the importer expands to, at maximum.
 * @type {number}
 * @private
 */
cm.InspectorPopup.MAX_HEIGHT_FRACTION_ = 0.9;

/**
 * Build and show an object property inspector.  Accepts a list of editor
 * specifications (indicating which properties to edit and the types of editors
 * to show), and optionally a MapModel, LayerModel, or TopicModel to populate
 * the initial values with.  If the user presses "OK", the edits are applied
 * all at once in a single EditCommand, or a new LayerModel (isNewLayer=true)
 * or TopicModel (isNewLayer=false) is created if no object was given.
 * @param {string} title The title to show on the dialog.
 * @param {Array.<cm.EditorSpec>} editorSpecs An array of editor specifications.
 * @param {cm.AppState} appState The application state.
 * @param {cm.MapModel|cm.LayerModel|cm.TopicModel} modelToEdit If not null,
 *     the MapModel, LayerModel, or TopicModel whose properties will be edited.
 *     Otherwise, a blank inspector will be displayed, and a new LayerModel
 *     or TopicModel will be created on OK depending on the value of isNewLayer.
 * @param {boolean} isNewLayer If object is null and this is true, create a new
 *     LayerModel on OK, else create a TopicModel.
 */
cm.InspectorPopup.prototype.inspect = function(
    title, editorSpecs, appState, modelToEdit, isNewLayer) {
  // We bind the editors to a separate "draft" copy of the modelToEdit (instead
  // of the original) so we can apply all the edits in a single Command.
  this.isNewLayer_ = isNewLayer;
  this.isNewTopic_ = !modelToEdit && !isNewLayer;

  cm.ui.setText(this.titleElem_, title);
  goog.dom.classes.enable(this.copyLayerLink_, cm.css.HIDDEN,
      !!modelToEdit || this.isNewTopic_);

  this.inspector_.inspect(editorSpecs, modelToEdit);

  // Watch enabled_layer_ids and close the inspector if this layer is disabled.
  this.appState_ = appState;
  cm.events.onChange(this.appState_, 'enabled_layer_ids',
                     this.cancelIfLayerDisabled_, this);

  // Bring up the inspector dialog.
  cm.ui.showPopup(this.popup_);
  this.handleResize_();
  this.windowResizeListener_ = /** @type {cm.events.ListenerToken} */
        (cm.events.listen(window, 'resize',
            // Fails on IE8 if you do not bind cm.ui.document.body here
            goog.bind(this.handleResize_, this, cm.ui.document.body)));
  cm.events.emit(cm.app, cm.events.INSPECTOR_VISIBLE, {value: true});
};

/**
 * Switches to importer dialog.
 * @private
 */
cm.InspectorPopup.prototype.handleCopyClick_ = function() {
  cm.events.emit(cm.app, cm.events.IMPORT);
  cm.events.emit(cm.app, cm.events.INSPECTOR_VISIBLE, {value: false});
  cm.ui.remove(this.popup_);
};

/**
 * Applies the user's edits by emitting an undoable EditCommand.
 * @private
 */
cm.InspectorPopup.prototype.handleOk_ = function() {
  var edits = this.inspector_.collectEdits();

  if (this.isNewLayer_) {
    cm.events.emit(cm.app, cm.events.NEW_LAYER, {properties: edits.newValues});
  } else if (this.isNewTopic_) {
    cm.events.emit(cm.app, cm.events.NEW_TOPIC, {properties: edits.newValues});
  } else {
    var object = this.inspector_.getOriginal();
    cm.events.emit(cm.app, cm.events.OBJECT_EDITED, {
      oldValues: edits.oldValues,
      newValues: edits.newValues,
      layerId: object instanceof cm.LayerModel ? object.get('id') : null,
      topicId: object instanceof cm.TopicModel ? object.get('id') : null
    });
  }
  this.dispose_(true);
};

/**
 * Cancels the user's edits.
 * @private
 */
cm.InspectorPopup.prototype.handleCancel_ = function() {
  this.dispose_(true);
};

/**
 * Updates the maximum height of the layer list based on the defined maximum
 * height of the popup (cm.InspectorPopup.MAX_HEIGHT_FRACTION_), and repositions
 * the popup to center it, assuming it is its maximum size.
 * Should be called whenever the size of the popup's container has changed.
 * @param {Element=} opt_container Parent container of the popup; defaults to
 *     cm.ui.document.body.
 * @private
 */
cm.InspectorPopup.prototype.handleResize_ = function(opt_container) {
  var container = opt_container || cm.ui.document.body;
  var maxPopupHeight = Math.round(
      container.offsetHeight * cm.InspectorPopup.MAX_HEIGHT_FRACTION_);

  // Anchor popup such that it is centered in the case of maximum
  // width and height. This is so that may grow to this size without going
  // offscreen.
  this.popup_.style.top = Math.round((container.offsetHeight -
      maxPopupHeight) / 2) + 'px';
  this.popup_.style.left = Math.round((container.offsetWidth -
      this.popup_.offsetWidth) / 2) + 'px'; // width == max-width for inspector
};

/**
 * Dispose of the inspector's various editors, and optionally the inspector
 * popup itself.
 * @param {boolean=} opt_disposePopup If true, dispose of the popup.
 * @private
 */
cm.InspectorPopup.prototype.dispose_ = function(opt_disposePopup) {
  this.inspector_.dispose();
  if (opt_disposePopup) {
    cm.events.unlisten(this.windowResizeListener_, this);
    cm.events.emit(cm.app, cm.events.INSPECTOR_VISIBLE, {value: false});
    cm.ui.remove(this.popup_);
  }
};

/**
 * Closes the inspector view if the layer has been disabled.
 * @private
 */
cm.InspectorPopup.prototype.cancelIfLayerDisabled_ = function() {
  // Close the inspector view only if the layer isn't new and isn't enabled.
  var object = this.inspector_.getOriginal();
  if (object instanceof cm.LayerModel && !this.isNewLayer_ &&
      !this.appState_.getLayerEnabled(object.get('id'))) {
    this.handleCancel_();
  }
};
